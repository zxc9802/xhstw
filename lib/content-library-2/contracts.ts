import {
  CONTENT_IMAGE_TYPES,
  createContentId,
  mediaFileId,
  parseImageDescriptors,
  type ImageDescriptor
} from "@/lib/content-storage/contracts";

export const LIBRARY2_NAME = "manual";
export const LIBRARY2_PLATFORMS = ["小红书", "抖音", "TikTok"] as const;
export const LIBRARY2_TITLE_MAX = 200;
export const LIBRARY2_BODY_MAX = 20_000;
export const LIBRARY2_URL_MAX = 2_048;

export type Library2Platform = (typeof LIBRARY2_PLATFORMS)[number];

export interface Library2Image {
  fileId: string;
  key: string;
  contentType: string;
  size: number;
}

export interface Library2Item {
  schemaVersion: 1;
  id: string;
  ownerId: string;
  library: typeof LIBRARY2_NAME;
  platform: Library2Platform;
  sourceUrl: string;
  title: string;
  body: string;
  images: Library2Image[];
  createdAt: string;
  updatedAt: string;
}

export interface Library2Draft {
  title: string;
  body: string;
  platform: Library2Platform;
  sourceUrl: string;
}

export interface Library2UploadObject extends ImageDescriptor {
  fileId: string;
  key: string;
}

const CONTENT_ID_PATTERN = /^\d{8}T\d{9}Z-[0-9a-f]{12}$/;
const FILE_ID_PATTERN = /^\d{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif|avif)$/;

function encodeOwnerId(ownerId: string): string {
  if (!ownerId.trim()) throw new Error("ownerId不能为空");
  return encodeURIComponent(ownerId).replace(/\./g, "%2E");
}

export function userLibrary2Prefix(ownerId: string): string {
  return `users/${encodeOwnerId(ownerId)}/library2/`;
}

export function validateLibrary2ContentId(contentId: string): void {
  if (!CONTENT_ID_PATTERN.test(contentId)) throw new Error("contentId无效");
}

export function validateLibrary2FileId(fileId: string): void {
  if (!FILE_ID_PATTERN.test(fileId)) throw new Error("fileId无效");
}

export function library2ManifestKey(ownerId: string, contentId: string): string {
  validateLibrary2ContentId(contentId);
  return `${userLibrary2Prefix(ownerId)}${contentId}/manifest.json`;
}

export function library2ImageKey(ownerId: string, contentId: string, fileId: string): string {
  validateLibrary2ContentId(contentId);
  validateLibrary2FileId(fileId);
  return `${userLibrary2Prefix(ownerId)}${contentId}/images/${fileId}`;
}

export function createLibrary2Id(now: Date, id: string): string {
  return createContentId(now, id);
}

export function createLibrary2FileId(index: number, contentType: string, id: string): string {
  return mediaFileId(index, contentType, id);
}

export function parseLibrary2Images(value: unknown): ImageDescriptor[] {
  return parseImageDescriptors(value);
}

export function isLibrary2Platform(value: unknown): value is Library2Platform {
  return typeof value === "string" && (LIBRARY2_PLATFORMS as readonly string[]).includes(value);
}

function boundedText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw new Error(`${field}无效`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field}过长`);
  return text;
}

export function parseLibrary2Draft(value: unknown): Library2Draft {
  if (!value || typeof value !== "object") throw new Error("图文内容无效");
  const input = value as Record<string, unknown>;
  if (!isLibrary2Platform(input.platform)) throw new Error("平台无效");
  const sourceUrl = boundedText(input.sourceUrl ?? "", LIBRARY2_URL_MAX, "来源链接");
  if (sourceUrl) {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new Error("来源链接无效");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("来源链接无效");
  }
  const title = boundedText(input.title ?? "", LIBRARY2_TITLE_MAX, "标题");
  const body = boundedText(input.body ?? "", LIBRARY2_BODY_MAX, "文案");
  return {
    title: title || "未命名图文",
    body,
    platform: input.platform,
    sourceUrl
  };
}

export function library2ContentTypeExtension(contentType: string): string {
  const extension = CONTENT_IMAGE_TYPES.get(contentType);
  if (!extension) throw new Error("不支持的图片类型");
  return extension;
}
