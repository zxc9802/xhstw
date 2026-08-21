import { randomUUID } from "node:crypto";
import {
  createContentId,
  imageObjectKey,
  manifestObjectKey,
  mediaFileId,
  parseImageDescriptors,
  userContentsPrefix,
  type ContentDraft,
  type StoredContentManifest,
  type StoredMedia,
  type UploadIntentObject
} from "./contracts";
import type { ContentStorageGateway } from "./gateway";

type IntentOptions = { now?: Date; ids?: string[] };
type UploadedFile = UploadIntentObject & { uploadUrl?: string };

export async function createUploadIntent(
  ownerId: string,
  input: unknown,
  gateway: ContentStorageGateway,
  options: IntentOptions = {}
) {
  const images = parseImageDescriptors(input);
  const ids = [...(options.ids ?? [])];
  const contentId = createContentId(options.now ?? new Date(), ids.shift() ?? randomUUID());
  const objects = images.map((image, index) => {
    const fileId = mediaFileId(index, image.contentType, ids.shift() ?? randomUUID());
    return { ...image, fileId, key: imageObjectKey(ownerId, contentId, fileId) };
  });
  return {
    contentId,
    uploads: await Promise.all(objects.map(async (object) => ({
      ...object,
      uploadUrl: await gateway.createPutUrl(object.key, object.contentType)
    })))
  };
}

async function uploadedMedia(
  ownerId: string,
  contentId: string,
  files: UploadedFile[],
  gateway: ContentStorageGateway
) {
  const media: StoredMedia[] = [];
  for (const [index, file] of files.entries()) {
    const key = imageObjectKey(ownerId, contentId, file.fileId);
    if (file.key !== key) throw new Error("图片对象路径无效");
    const head = await gateway.headObject(key);
    if (!head) throw new Error(`第 ${index + 1} 张图片尚未上传`);
    if (head.contentType !== file.contentType || head.size !== file.size) {
      throw new Error(`第 ${index + 1} 张图片信息不一致`);
    }
    media.push({ storage: "cos", fileId: file.fileId, key, contentType: file.contentType, size: file.size });
  }
  return media;
}

function externalVideoMedia(urls: string[]): StoredMedia[] {
  return urls.flatMap((value, index) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
      return [{ storage: "external" as const, fileId: `video-${index + 1}`, mediaType: "video" as const, url: url.toString() }];
    } catch {
      return [];
    }
  });
}

export async function commitContent(
  ownerId: string,
  contentId: string,
  draft: ContentDraft,
  files: UploadedFile[],
  gateway: ContentStorageGateway,
  now = new Date()
) {
  const media = await uploadedMedia(ownerId, contentId, files, gateway);
  const { externalVideoUrls, ...content } = draft;
  const timestamp = now.toISOString();
  const manifest: StoredContentManifest = {
    schemaVersion: 1,
    id: contentId,
    ownerId,
    ...content,
    media: [...media, ...externalVideoMedia(externalVideoUrls)],
    systemState: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await gateway.putJson(manifestObjectKey(ownerId, contentId), manifest);
  return manifest;
}

export async function getContent(
  ownerId: string,
  contentId: string,
  gateway: ContentStorageGateway
) {
  const value = await gateway.getJson(manifestObjectKey(ownerId, contentId));
  if (!value || typeof value !== "object") return undefined;
  const manifest = value as StoredContentManifest;
  return manifest.ownerId === ownerId && manifest.systemState === "active" ? manifest : undefined;
}

export async function listContents(ownerId: string, gateway: ContentStorageGateway) {
  const keys = (await gateway.listKeys(userContentsPrefix(ownerId)))
    .filter((key) => key.endsWith("/manifest.json"))
    .sort()
    .reverse();
  const rows = await Promise.all(keys.map((key) => gateway.getJson(key)));
  return rows.filter((value): value is StoredContentManifest => Boolean(
    value && typeof value === "object"
      && (value as StoredContentManifest).ownerId === ownerId
      && (value as StoredContentManifest).systemState === "active"
  ));
}

export async function getContentMedia(
  ownerId: string,
  contentId: string,
  fileId: string,
  gateway: ContentStorageGateway
) {
  const manifest = await getContent(ownerId, contentId, gateway);
  const media = manifest?.media.find((item) => item.storage === "cos" && item.fileId === fileId);
  return media?.storage === "cos" ? gateway.getObject(media.key) : undefined;
}

export async function deleteContent(ownerId: string, contentId: string, gateway: ContentStorageGateway) {
  const manifest = await getContent(ownerId, contentId, gateway);
  if (!manifest) return;
  const keys = manifest.media.flatMap((media) => media.storage === "cos" ? [media.key] : []);
  await gateway.deleteKeys([...keys, manifestObjectKey(ownerId, contentId)]);
}
