export type XhsReferenceMedia = {
  type: "image" | "video";
  url: string;
  name: string;
  localAssetKey?: string;
};

type MediaBlobStore = {
  getBlob(assetKey: string): Promise<Blob | null>;
};

export function normalizeXhsReferenceMedia(media: unknown): XhsReferenceMedia[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item, index) => {
    const record = item && typeof item === "object" ? item as Partial<XhsReferenceMedia> : null;
    if (!record?.url || typeof record.url !== "string") return [];
    return [{
      type: record.type === "video" ? "video" as const : "image" as const,
      url: record.url,
      name: typeof record.name === "string" && record.name ? record.name : `OpenCLI 采集素材 ${index + 1}`,
      ...(typeof record.localAssetKey === "string" && record.localAssetKey ? { localAssetKey: record.localAssetKey } : {})
    }];
  });
}

export async function loadXhsReferenceMediaObjectUrls(
  media: XhsReferenceMedia[],
  store: MediaBlobStore,
  createObjectUrl: (blob: Blob) => string
) {
  const objectUrls = new Map<string, string>();
  const assetKeys = Array.from(new Set(media.flatMap((item) => item.localAssetKey ? [item.localAssetKey] : [])));
  await Promise.all(assetKeys.map(async (assetKey) => {
    try {
      const blob = await store.getBlob(assetKey);
      if (blob) objectUrls.set(assetKey, createObjectUrl(blob));
    } catch {
      // Keep the original remote URL when browser storage is unavailable.
    }
  }));
  return objectUrls;
}

export function resolveXhsReferenceMedia(
  media: XhsReferenceMedia[],
  objectUrls: ReadonlyMap<string, string>
) {
  return media.map((item) => ({
    ...item,
    url: item.localAssetKey ? objectUrls.get(item.localAssetKey) ?? item.url : item.url
  }));
}
