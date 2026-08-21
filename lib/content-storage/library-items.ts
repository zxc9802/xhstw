import { contentMediaUrl } from "./client";
import type { ContentDraft, RiskLevel, StoredContentManifest } from "./contracts";

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
  legacySourceId?: string;
  duplicateRate: number;
  duplicateLabel: string;
  lowFlowRisk: RiskLevel;
  localPath: string;
  prompts: string[];
  negativePrompts: string[];
  checkAdvice: string[];
  reviewNotes: string[];
  manifest?: StoredContentManifest;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function risk(value: unknown): RiskLevel {
  return value === "中" || value === "高" ? value : "低";
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
    legacySourceId: item.legacySourceId,
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
    updatedAt: item.updatedAt,
    duplicateRate: item.duplicateRate,
    duplicateLabel: item.duplicateLabel,
    lowFlowRisk: item.lowFlowRisk,
    localPath: "腾讯云 COS",
    prompts: item.prompts,
    negativePrompts: item.negativePrompts,
    checkAdvice: item.checkAdvice,
    reviewNotes: item.reviewNotes,
    manifest: item
  };
}

export function editableContentDraft(
  manifest: StoredContentManifest,
  changes: Pick<ContentDraft, "title" | "body" | "tags">
): ContentDraft {
  return {
    legacySourceId: manifest.legacySourceId,
    title: changes.title,
    summary: manifest.summary,
    body: changes.body,
    platform: manifest.platform,
    account: manifest.account,
    type: manifest.type,
    mediaKind: manifest.mediaKind,
    pages: manifest.pages,
    referenceSources: manifest.referenceSources,
    tags: changes.tags,
    folder: manifest.folder,
    prompts: manifest.prompts,
    negativePrompts: manifest.negativePrompts,
    status: manifest.status,
    duplicateRate: manifest.duplicateRate,
    duplicateLabel: manifest.duplicateLabel,
    lowFlowRisk: manifest.lowFlowRisk,
    checkAdvice: manifest.checkAdvice,
    reviewNotes: manifest.reviewNotes,
    externalVideoUrls: manifest.media.flatMap((media) => media.storage === "external" ? [media.url] : [])
  };
}

export function legacyContentDraft(
  item: ContentLibraryItem,
  changes: Pick<ContentDraft, "title" | "body" | "tags">
): ContentDraft {
  return {
    legacySourceId: item.id,
    title: changes.title,
    summary: item.summary,
    body: changes.body,
    platform: item.platform,
    account: item.account,
    type: item.type,
    mediaKind: item.mediaKind,
    pages: [],
    referenceSources: [],
    tags: changes.tags,
    folder: null,
    prompts: item.prompts,
    negativePrompts: item.negativePrompts,
    status: item.status === "可发布" || item.status === "已归档" || item.status === "已淘汰" ? item.status : "需复查",
    duplicateRate: item.duplicateRate,
    duplicateLabel: item.duplicateLabel,
    lowFlowRisk: item.lowFlowRisk,
    checkAdvice: item.checkAdvice,
    reviewNotes: item.reviewNotes,
    externalVideoUrls: item.videoUrls
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
        updatedAt: text(row.updatedAt, text(row.createdAt)),
        duplicateRate: number(row.duplicateRate),
        duplicateLabel: text(row.duplicateLabel, "待检测"),
        lowFlowRisk: risk(row.lowFlowRisk),
        localPath: text(row.localPath, "浏览器旧内容"),
        prompts: textList(row.prompts),
        negativePrompts: textList(row.negativePrompts),
        checkAdvice: textList(row.checkAdvice),
        reviewNotes: textList(row.reviewNotes)
      }];
    });
  } catch {
    return [];
  }
}

export function mergeContentLibraryItems(cloudItems: ContentLibraryItem[], browserItems: ContentLibraryItem[]) {
  const migratedLegacyIds = new Set(cloudItems.flatMap((item) => item.legacySourceId ? [item.legacySourceId] : []));
  const merged = new Map(browserItems.filter((item) => !migratedLegacyIds.has(item.id)).map((item) => [item.id, item]));
  cloudItems.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
