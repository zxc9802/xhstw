import { randomUUID } from "node:crypto";

export const IMAGE_GENERATION_RESULT_TTL_MS = 30 * 60 * 1000;
export const MAX_IMAGE_GENERATION_RESULT_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_GENERATION_RESULT_SET_BYTES = 100 * 1024 * 1024;
const MAX_CACHED_IMAGE_GENERATION_RESULT_BYTES = 256 * 1024 * 1024;
export const IMAGE_GENERATION_RESULT_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
export const IMAGE_GENERATION_RESULT_DOWNLOAD_MAX_ATTEMPTS = 3;
export const IMAGE_GENERATION_RESULT_DOWNLOAD_CONCURRENCY = 2;

type StoredImageGenerationResult = {
  token: string;
  bytes: Uint8Array;
  contentType: string;
  expiresAt: number;
};

const resultGlobal = globalThis as typeof globalThis & {
  __imageGenerationResults?: Map<string, StoredImageGenerationResult>;
};

const results = resultGlobal.__imageGenerationResults ?? new Map<string, StoredImageGenerationResult>();
resultGlobal.__imageGenerationResults = results;

function cleanupExpiredResults(now: number) {
  for (const [token, result] of results) {
    if (result.expiresAt <= now) results.delete(token);
  }
}

function normalizedResultOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("unsafe");
    return parsed.origin;
  } catch {
    throw new Error("成品图片暂存地址无效，请检查应用公开域名。");
  }
}

function imageContentType(response: Response, source: string) {
  const header = (response.headers.get("Content-Type") || "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const normalized = header === "image/jpg" ? "image/jpeg" : header;
  if (normalized.startsWith("image/")) return normalized;
  const extension = new URL(source).pathname.toLowerCase().match(/\.(avif|gif|jpe?g|png|webp)$/)?.[1];
  if (!extension) return undefined;
  return ({
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  } as Record<string, string>)[extension];
}

async function downloadImage(source: string) {
  try {
    const response = await fetch(source, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_GENERATION_RESULT_DOWNLOAD_TIMEOUT_MS)
    });
    const contentType = imageContentType(response, source);
    if (!response.ok || !contentType) {
      throw new Error(`HTTP ${response.status}`);
    }
    const statedLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(statedLength) && statedLength > MAX_IMAGE_GENERATION_RESULT_BYTES) {
      throw new Error("单张成品图片超过 20 MB");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error("图片内容为空");
    if (bytes.byteLength > MAX_IMAGE_GENERATION_RESULT_BYTES) {
      throw new Error("单张成品图片超过 20 MB");
    }
    return { bytes, contentType };
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    throw new Error(`成品图片后台下载失败：${message}`);
  }
}

function retryableDownloadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|terminated|aborted|fetch failed|econnreset|econnrefused|socket hang up|HTTP (?:408|425|429|5\d\d)/i.test(message);
}

async function waitBeforeDownloadRetry(attempt: number) {
  if (process.env.NODE_TEST_CONTEXT) return;
  await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
}

async function downloadImageWithRetry(source: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= IMAGE_GENERATION_RESULT_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await downloadImage(source);
    } catch (error) {
      lastError = error;
      if (attempt === IMAGE_GENERATION_RESULT_DOWNLOAD_MAX_ATTEMPTS || !retryableDownloadError(error)) {
        throw error;
      }
      await waitBeforeDownloadRetry(attempt);
    }
  }
  throw lastError;
}

async function settleWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  const results: PromiseSettledResult<T>[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = { status: "fulfilled", value: await tasks[currentIndex]() };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function cacheImageGenerationResult(result: unknown, origin: string) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.images)) return result;

  const remoteImages = record.images.flatMap((image, index) => {
    if (!image || typeof image !== "object") return [];
    const url = (image as Record<string, unknown>).url;
    return typeof url === "string" && /^https?:\/\//i.test(url) ? [{ index, url }] : [];
  });
  if (!remoteImages.length) return result;

  normalizedResultOrigin(origin);
  const downloadResults = await settleWithConcurrency(
    remoteImages.map(({ index, url }) => async () => ({
      index,
      ...(await downloadImageWithRetry(url))
    })),
    IMAGE_GENERATION_RESULT_DOWNLOAD_CONCURRENCY
  );
  const downloaded = downloadResults.flatMap((download) => download.status === "fulfilled" ? [download.value] : []);
  const failedDownloads = downloadResults.flatMap((download, downloadIndex) => download.status === "rejected"
    ? [{
        index: remoteImages[downloadIndex].index,
        error: download.reason instanceof Error ? download.reason.message : String(download.reason)
      }]
    : []);
  const failedIndexes = new Set(failedDownloads.map((download) => download.index));
  const remainingImages = record.images.filter((_, index) => !failedIndexes.has(index));
  if (!remainingImages.length && failedDownloads.length) {
    throw new Error(failedDownloads[0].error);
  }
  const totalBytes = downloaded.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  if (totalBytes > MAX_IMAGE_GENERATION_RESULT_SET_BYTES) {
    throw new Error("单次生成的成品图片总大小超过 100 MB。");
  }

  const now = Date.now();
  cleanupExpiredResults(now);
  const cachedBytes = [...results.values()].reduce((sum, image) => sum + image.bytes.byteLength, 0);
  if (cachedBytes + totalBytes > MAX_CACHED_IMAGE_GENERATION_RESULT_BYTES) {
    throw new Error("成品图片暂存空间不足，请稍后重试。");
  }

  const replacements = new Map<number, string>();
  for (const image of downloaded) {
    const token = randomUUID();
    results.set(token, {
      token,
      bytes: image.bytes,
      contentType: image.contentType,
      expiresAt: now + IMAGE_GENERATION_RESULT_TTL_MS
    });
    replacements.set(image.index, `/api/image/result/${token}`);
  }

  const previousWarnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const warnings = failedDownloads.length
    ? [
        ...previousWarnings,
        `${failedDownloads.length} 张成品图片后台下载失败，已保留其余 ${remainingImages.length} 张：${failedDownloads[0].error}`
      ]
    : previousWarnings;

  return {
    ...record,
    images: record.images.map((image, index) => {
      const url = replacements.get(index);
      return url && image && typeof image === "object"
        ? { ...(image as Record<string, unknown>), url }
        : image;
    }).filter((_, index) => !failedIndexes.has(index)),
    ...(warnings.length ? { warnings } : {})
  };
}

export function getImageGenerationResult(token: string, now = Date.now()) {
  cleanupExpiredResults(now);
  const result = results.get(token);
  return result
    ? { ...result, bytes: new Uint8Array(result.bytes) }
    : undefined;
}
