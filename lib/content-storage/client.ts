import { canonicalImageContentType, type ContentDraft, type StoredContentManifest, type UploadIntentObject } from "./contracts";

type Fetcher = typeof fetch;
type UploadPlan = {
  contentId: string;
  uploads: Array<UploadIntentObject & { uploadUrl: string }>;
};

async function apiData<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => undefined) as { ok?: boolean; data?: T; message?: string } | undefined;
  if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || `请求失败（${response.status}）`);
  return payload.data as T;
}

export async function saveContentDraft(
  content: ContentDraft,
  images: Blob[],
  options: { fetcher?: Fetcher; onProgress?: (completed: number, total: number) => void } = {}
) {
  const fetcher = options.fetcher ?? fetch;
  const intent = await apiData<UploadPlan>(await fetcher("/api/content-storage/upload-intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: images.map((image) => ({ contentType: canonicalImageContentType(image.type) || image.type, size: image.size })) })
  }));
  if (intent.uploads.length !== images.length) throw new Error("上传地址数量不一致");
  for (const [index, upload] of intent.uploads.entries()) {
    const response = await fetcher(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: images[index]
    });
    if (!response.ok) throw new Error(`第 ${index + 1} 张图片上传失败`);
    options.onProgress?.(index + 1, images.length);
  }
  return apiData<StoredContentManifest>(await fetcher(`/api/content-storage/items/${encodeURIComponent(intent.contentId)}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, uploads: intent.uploads })
  }));
}

export async function replaceContentDraft(
  contentId: string,
  content: ContentDraft,
  images: Blob[],
  options: { fetcher?: Fetcher; onProgress?: (completed: number, total: number) => void } = {}
) {
  const fetcher = options.fetcher ?? fetch;
  const itemUrl = `/api/content-storage/items/${encodeURIComponent(contentId)}`;
  const intent = await apiData<UploadPlan>(await fetcher(`${itemUrl}/upload-intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: images.map((image) => ({ contentType: canonicalImageContentType(image.type) || image.type, size: image.size })) })
  }));
  if (intent.contentId !== contentId || intent.uploads.length !== images.length) throw new Error("上传地址数量不一致");
  for (const [index, upload] of intent.uploads.entries()) {
    const response = await fetcher(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: images[index]
    });
    if (!response.ok) throw new Error(`第 ${index + 1} 张图片上传失败`);
    options.onProgress?.(index + 1, images.length);
  }
  return apiData<StoredContentManifest>(await fetcher(itemUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, uploads: intent.uploads })
  }));
}

export async function listContentItems(fetcher: Fetcher = fetch) {
  return apiData<StoredContentManifest[]>(await fetcher("/api/content-storage/items"));
}

export async function deleteContentItem(contentId: string, fetcher: Fetcher = fetch) {
  await apiData(await fetcher(`/api/content-storage/items/${encodeURIComponent(contentId)}`, { method: "DELETE" }));
}

export function contentMediaUrl(contentId: string, fileId: string) {
  return `/api/content-storage/items/${encodeURIComponent(contentId)}/media/${encodeURIComponent(fileId)}`;
}
