import { contentMediaUrl } from "./client";
import type { StoredContentManifest } from "./contracts";

export const LEGACY_FINISHED_CONTENT_STORAGE_KEY = "content-production-studio-xhs.finished-content";

export type ContentLibraryItem = {
  source: "cos" | "browser";
  id: string;
  title: string;
  summary: string;
  body: string;
  platform: string;
  account: string;
  type: string;
  mediaKind: "image" | "video";
  imageUrls: string[];
  videoUrls: string[];
  tags: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

function legacyMediaUrls(value: Record<string, unknown>) {
  const pageUrls = Array.isArray(value.pages)
    ? value.pages.flatMap((page) => page && typeof page === "object" ? textList((page as Record<string, unknown>).images) : [])
    : [];
  return [...new Set([...textList(value.mediaUrls), ...pageUrls])];
}

export function cloudContentItem(item: StoredContentManifest): ContentLibraryItem {
  return {
    source: "cos",
    id: item.id,
    title: item.title,
    summary: item.summary,
    body: item.body,
    platform: item.platform,
    account: item.account,
    type: item.type,
    mediaKind: item.mediaKind,
    imageUrls: item.media.flatMap((media) => media.storage === "cos" ? [contentMediaUrl(item.id, media.fileId)] : []),
    videoUrls: item.media.flatMap((media) => media.storage === "external" ? [media.url] : []),
    tags: item.tags,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

export function parseLegacyContentItems(raw: string | null): ContentLibraryItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const row = candidate as Record<string, unknown>;
      const id = text(row.id).trim();
      if (!id) return [];
      const mediaKind = row.mediaKind === "video" ? "video" as const : "image" as const;
      const mediaUrls = legacyMediaUrls(row);
      return [{
        source: "browser" as const,
        id,
        title: text(row.title, "未命名内容"),
        summary: text(row.summary),
        body: text(row.body),
        platform: text(row.platform, "小红书"),
        account: text(row.account, "未指定账号"),
        type: text(row.type, mediaKind === "image" ? "图文" : "视频"),
        mediaKind,
        imageUrls: mediaKind === "image" ? mediaUrls : [],
        videoUrls: mediaKind === "video" ? mediaUrls : [],
        tags: textList(row.tags),
        status: text(row.status, "需复查"),
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt, text(row.createdAt))
      }];
    });
  } catch {
    return [];
  }
}

export function mergeContentLibraryItems(cloudItems: ContentLibraryItem[], browserItems: ContentLibraryItem[]) {
  const merged = new Map(browserItems.map((item) => [item.id, item]));
  cloudItems.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
