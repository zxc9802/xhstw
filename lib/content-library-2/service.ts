import { randomUUID } from "node:crypto";
import type { ContentStorageGateway } from "@/lib/content-storage/gateway";
import type { UploadIntentObject } from "@/lib/content-storage/contracts";
import {
  createLibrary2FileId,
  createLibrary2Id,
  createLibrary2LiveFileId,
  library2ImageKey,
  library2LiveKey,
  library2ManifestKey,
  LIBRARY2_NAME,
  parseLibrary2Draft,
  parseLibrary2Images,
  parseLibrary2LiveDescriptors,
  userLibrary2Prefix,
  validateLibrary2ContentId,
  validateLibrary2FileId,
  type Library2Draft,
  type Library2Image,
  type Library2Item,
  type Library2LiveUploadObject,
  type Library2UploadObject
} from "./contracts";
import { createLibrary2LiveUploadCapability, createLibrary2UploadCapability } from "./upload-capability";

type IntentOptions = { now?: Date; ids?: string[] };
type UploadedFile = UploadIntentObject & { uploadUrl?: string };

function uploadUrl(contentId: string, fileId: string, token: string) {
  const path = `/api/library2/items/${encodeURIComponent(contentId)}/media/${encodeURIComponent(fileId)}/upload`;
  return `${path}?${new URLSearchParams({ token })}`;
}

function liveUploadUrl(contentId: string, fileId: string, token: string) {
  const path = `/api/library2/items/${encodeURIComponent(contentId)}/live/${encodeURIComponent(fileId)}/upload`;
  return `${path}?${new URLSearchParams({ token })}`;
}

export async function createLibrary2UploadIntent(
  ownerId: string,
  input: unknown,
  _gateway: ContentStorageGateway,
  options: IntentOptions = {}
) {
  const request = Array.isArray(input) ? { images: input, livePhotos: [] } : input as { images?: unknown; livePhotos?: unknown };
  const images = parseLibrary2Images(request?.images);
  const livePhotos = parseLibrary2LiveDescriptors(request?.livePhotos);
  if (livePhotos.length > images.length) throw new Error("Live 封面数量无效");
  const ids = [...(options.ids ?? [])];
  const contentId = createLibrary2Id(options.now ?? new Date(), ids.shift() ?? randomUUID());
  const objects: Library2UploadObject[] = images.map((image, index) => {
    const fileId = createLibrary2FileId(index, image.contentType, ids.shift() ?? randomUUID());
    return { ...image, fileId, key: library2ImageKey(ownerId, contentId, fileId) };
  });
  const intentTime = (options.now ?? new Date()).getTime();
  const liveObjects: Library2LiveUploadObject[] = livePhotos.map((live) => {
    const cover = objects[live.coverIndex];
    if (!cover) throw new Error("Live 封面无效");
    const fileId = createLibrary2LiveFileId(live.order, ids.shift() ?? randomUUID());
    return {
      ...live,
      fileId,
      coverFileId: cover.fileId,
      key: library2LiveKey(ownerId, contentId, fileId)
    };
  });
  return {
    contentId,
    uploads: objects.map((object) => ({
      ...object,
      uploadUrl: uploadUrl(
        contentId,
        object.fileId,
        createLibrary2UploadCapability(ownerId, contentId, object.fileId, object, intentTime)
      )
    })),
    liveUploads: liveObjects.map((object) => ({
      ...object,
      uploadUrl: liveUploadUrl(
        contentId,
        object.fileId,
        createLibrary2LiveUploadCapability(ownerId, contentId, object.fileId, object, intentTime)
      )
    }))
  };
}

async function uploadedImages(
  ownerId: string,
  contentId: string,
  files: UploadedFile[],
  gateway: ContentStorageGateway
): Promise<Library2Image[]> {
  const images: Library2Image[] = [];
  for (const [index, file] of files.entries()) {
    const key = library2ImageKey(ownerId, contentId, file.fileId);
    if (file.key !== key) throw new Error("图片对象路径无效");
    const head = await gateway.headObject(key);
    if (!head) throw new Error(`第 ${index + 1} 张图片尚未上传`);
    if (head.contentType !== file.contentType || head.size !== file.size) {
      throw new Error(`第 ${index + 1} 张图片信息不一致`);
    }
    images.push({ fileId: file.fileId, key, contentType: file.contentType, size: file.size });
  }
  return images;
}

export async function commitLibrary2Item(
  ownerId: string,
  contentId: string,
  draftInput: unknown,
  files: UploadedFile[],
  gateway: ContentStorageGateway,
  now = new Date()
) {
  validateLibrary2ContentId(contentId);
  const draft = parseLibrary2Draft(draftInput);
  const images = await uploadedImages(ownerId, contentId, files, gateway);
  if (!images.length && !draft.body) throw new Error("图片和文案不能同时为空");
  const timestamp = now.toISOString();
  const item: Library2Item = {
    schemaVersion: 1,
    id: contentId,
    ownerId,
    library: LIBRARY2_NAME,
    ...draft,
    images,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await gateway.putJson(library2ManifestKey(ownerId, contentId), item);
  return item;
}

export async function getLibrary2Item(
  ownerId: string,
  contentId: string,
  gateway: ContentStorageGateway
) {
  const value = await gateway.getJson(library2ManifestKey(ownerId, contentId));
  if (!value || typeof value !== "object") return undefined;
  const item = value as Library2Item;
  return item.ownerId === ownerId && item.library === LIBRARY2_NAME ? item : undefined;
}

export async function listLibrary2Items(ownerId: string, gateway: ContentStorageGateway) {
  const keys = (await gateway.listKeys(userLibrary2Prefix(ownerId)))
    .filter((key) => key.endsWith("/manifest.json"))
    .sort()
    .reverse();
  const rows = await Promise.all(keys.map((key) => gateway.getJson(key)));
  return rows.filter((value): value is Library2Item => Boolean(
    value
    && typeof value === "object"
    && (value as Library2Item).ownerId === ownerId
    && (value as Library2Item).library === LIBRARY2_NAME
  ));
}

export async function getLibrary2Media(
  ownerId: string,
  contentId: string,
  fileId: string,
  gateway: ContentStorageGateway
) {
  const item = await getLibrary2Item(ownerId, contentId, gateway);
  const image = item?.images.find((candidate) => candidate.fileId === fileId);
  return image ? gateway.getObject(image.key) : undefined;
}

export async function deleteLibrary2Image(
  ownerId: string,
  contentId: string,
  fileId: string,
  gateway: ContentStorageGateway,
  now = new Date()
) {
  validateLibrary2FileId(fileId);
  const item = await getLibrary2Item(ownerId, contentId, gateway);
  if (!item) throw new Error("内容不存在");
  const image = item.images.find((candidate) => candidate.fileId === fileId);
  if (!image) throw new Error("图片不存在");
  const next: Library2Item = {
    ...item,
    images: item.images.filter((candidate) => candidate.fileId !== fileId),
    updatedAt: now.toISOString()
  };
  await gateway.putJson(library2ManifestKey(ownerId, contentId), next);
  try {
    await gateway.deleteKeys([image.key]);
  } catch {
    // The updated manifest is already durable.
  }
  return next;
}

export async function clearLibrary2Body(
  ownerId: string,
  contentId: string,
  gateway: ContentStorageGateway,
  now = new Date()
) {
  const item = await getLibrary2Item(ownerId, contentId, gateway);
  if (!item) throw new Error("内容不存在");
  const next: Library2Item = {
    ...item,
    body: "",
    updatedAt: now.toISOString()
  };
  await gateway.putJson(library2ManifestKey(ownerId, contentId), next);
  return next;
}

export async function deleteLibrary2Item(
  ownerId: string,
  contentId: string,
  gateway: ContentStorageGateway
) {
  const item = await getLibrary2Item(ownerId, contentId, gateway);
  if (!item) return;
  await gateway.deleteKeys([
    ...item.images.map((image) => image.key),
    library2ManifestKey(ownerId, contentId)
  ]);
}

export function library2DraftFrom(input: Library2Draft): Library2Draft {
  return parseLibrary2Draft(input);
}
