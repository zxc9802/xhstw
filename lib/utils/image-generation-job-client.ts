export type ImageGenerationPollOptions = {
  fetcher?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type ImageGenerationJobPayload = {
  ok?: boolean;
  message?: string;
  error?: string;
  data?: {
    status?: string;
    result?: unknown;
    error?: string;
  };
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function extractGeneratedImageUrls(payload: unknown): string[] {
  if (!payload) return [];
  if (typeof payload === "string") {
    if (/^https?:\/\//.test(payload) || payload.startsWith("data:image/") || payload.startsWith("/api/image/result/")) return [payload];
    return [];
  }
  if (Array.isArray(payload)) return payload.flatMap(extractGeneratedImageUrls);
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return [record.url, record.image_url, record.b64_json ? `data:image/jpeg;base64,${record.b64_json}` : undefined, record.base64 ? `data:image/jpeg;base64,${record.base64}` : undefined, record.images, record.data]
      .flatMap(extractGeneratedImageUrls);
  }
  return [];
}

export function imageGenerationWarnings(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const warnings = (result as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim()));
}

export async function pollImageGenerationJob(jobId: string, options: ImageGenerationPollOptions = {}): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const intervalMs = options.intervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 6 * 60 * 1000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();

  while (true) {
    const response = await fetcher(`/api/image/generate/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as ImageGenerationJobPayload;
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || payload.error || "图片生成任务查询失败，请重新生成。");
    }

    const job = payload.data;
    if (job?.status === "completed") return job.result;
    if (job?.status === "failed") throw new Error(job.error || "图片生成失败，请重新生成。");
    if (job?.status !== "queued" && job?.status !== "processing") {
      throw new Error("图片生成任务返回了未知状态，请重新生成。");
    }
    if (now() - startedAt >= timeoutMs) {
      throw new Error("图片生成任务等待超时，请重新生成。");
    }

    await sleep(intervalMs);
  }
}
