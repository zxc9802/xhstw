import type { Library2Draft, Library2Item, Library2UploadObject } from "./contracts";

type Fetcher = typeof fetch;
type UploadPlan = {
  contentId: string;
  uploads: Array<Library2UploadObject & { uploadUrl: string }>;
};

async function apiData<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => undefined) as { ok?: boolean; data?: T; message?: string } | undefined;
  if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || `请求失败（${response.status}）`);
  return payload.data as T;
}

export async function saveLibrary2Item(
  content: Library2Draft,
  images: Blob[],
  options: { fetcher?: Fetcher; headers?: HeadersInit; onProgress?: (completed: number, total: number) => void } = {}
) {
  const fetcher = options.fetcher ?? fetch;
  const intent = await apiData<UploadPlan>(await fetcher("/api/library2/upload-intents", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({ images: images.map((image) => ({ contentType: image.type, size: image.size })) })
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
  return apiData<Library2Item>(await fetcher(`/api/library2/items/${encodeURIComponent(intent.contentId)}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({ content, uploads: intent.uploads })
  }));
}

export async function listLibrary2Items(fetcher: Fetcher = fetch) {
  return apiData<Library2Item[]>(await fetcher("/api/library2/items"));
}

export async function getLibrary2Item(contentId: string, fetcher: Fetcher = fetch) {
  return apiData<Library2Item>(await fetcher(`/api/library2/items/${encodeURIComponent(contentId)}`));
}

export async function deleteLibrary2Item(contentId: string, fetcher: Fetcher = fetch) {
  await apiData(await fetcher(`/api/library2/items/${encodeURIComponent(contentId)}`, { method: "DELETE" }));
}

export async function deleteLibrary2Image(contentId: string, fileId: string, fetcher: Fetcher = fetch) {
  return apiData<Library2Item>(await fetcher(
    `/api/library2/items/${encodeURIComponent(contentId)}/media/${encodeURIComponent(fileId)}`,
    { method: "DELETE" }
  ));
}

export async function clearLibrary2Body(contentId: string, fetcher: Fetcher = fetch) {
  return apiData<Library2Item>(await fetcher(`/api/library2/items/${encodeURIComponent(contentId)}/body`, {
    method: "DELETE"
  }));
}

export async function createLibrary2ExtensionSession(fetcher: Fetcher = fetch) {
  return apiData<{ token: string; expiresAt: number }>(await fetcher("/api/library2/extension-session", {
    method: "POST"
  }));
}

export function library2MediaUrl(contentId: string, fileId: string) {
  return `/api/library2/items/${encodeURIComponent(contentId)}/media/${encodeURIComponent(fileId)}`;
}
