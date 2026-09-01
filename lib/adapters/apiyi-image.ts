import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
import { MainAppBillingError, reserveMainAppCredits } from "@/lib/main-app-billing";

type ApiyiInput = {
  provider?: string;
  prompt?: string;
  size?: string;
  count?: number;
  sourceImageUrls?: string[];
};

type ApiyiConfig = {
  apiKey: string;
  generationUrl: string;
  editUrl: string;
  model: string;
};

const MAX_IMAGES_PER_RUN = 10;
const MAX_PARALLEL_IMAGE_REQUESTS = Math.max(1, Math.min(10, Number(process.env.OPENAI_IMAGE_PARALLEL_REQUESTS) || 4));
const MAX_RESPONSE_DEPTH = 6;
const RESPONSE_CONTAINER_KEYS = new Set([
  "content",
  "data",
  "image",
  "images",
  "message",
  "output",
  "outputs",
  "resource_urls",
  "resourceurls",
  "result",
  "results"
]);
const IMAGE_URL_KEYS = new Set(["url", "imageurl", "image_url"]);
const IMAGE_BASE64_KEYS = new Set(["b64_json", "base64", "image_base64", "image_data"]);
export const APIYI_IMAGE_TIMEOUT_MS = 360_000;

export function isApiyiImageProvider(provider: string) {
  return provider === "gpt-image2-vip";
}

function apiyiConfig(): ApiyiConfig {
  const apiKey = process.env.APIYI_IMAGE_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("gpt-image2-vip 配置缺失：APIYI_IMAGE_API_KEY");
  return {
    apiKey,
    generationUrl: process.env.APIYI_IMAGE_URL?.trim() || "https://api.apiyi.com/v1/images/generations",
    editUrl: process.env.APIYI_IMAGE_EDIT_URL?.trim() || "https://api.apiyi.com/v1/images/edits",
    model: process.env.APIYI_IMAGE_MODEL?.trim() || "gpt-image-2-vip"
  };
}

function imageSizeFromRatio(ratio = "1:1") {
  return ({
    "1:1": "2048x2048",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "9:16": "1152x2048",
    "16:9": "2048x1152"
  } as Record<string, string>)[ratio.trim().toLowerCase()] || "2048x2048";
}

function extractImageUrls(input: unknown) {
  const urls: string[] = [];

  function visit(value: unknown, key: string, depth: number) {
    if (depth > MAX_RESPONSE_DEPTH || value === null || value === undefined) return;
    const normalizedKey = key.toLowerCase();

    if (typeof value === "string") {
      if (IMAGE_BASE64_KEYS.has(normalizedKey)) {
        if (value.startsWith("data:image/")) urls.push(value);
        else if (value) urls.push(`data:image/png;base64,${value}`);
        return;
      }
      if (
        (IMAGE_URL_KEYS.has(normalizedKey) || RESPONSE_CONTAINER_KEYS.has(normalizedKey))
        && (/^https?:\/\//i.test(value) || value.startsWith("data:image/"))
      ) {
        urls.push(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      if (RESPONSE_CONTAINER_KEYS.has(normalizedKey)) {
        value.forEach((item) => visit(item, normalizedKey, depth + 1));
      }
      return;
    }

    if (typeof value !== "object") return;
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const childNormalizedKey = childKey.toLowerCase();
      if (
        RESPONSE_CONTAINER_KEYS.has(childNormalizedKey)
        || IMAGE_URL_KEYS.has(childNormalizedKey)
        || IMAGE_BASE64_KEYS.has(childNormalizedKey)
      ) {
        visit(childValue, childNormalizedKey, depth + 1);
      }
    }
  }

  visit(input, "data", 0);
  return [...new Set(urls)];
}

function providerError(data: unknown, fallback: string) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  for (const key of ["msg", "message", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") {
      const message = (value as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return fallback;
}

function assertApiyiResponse(response: Response, data: unknown, operation: "generate" | "edit", endpoint: string) {
  logImageProviderResponse({
    provider: "gpt-image2-vip",
    operation,
    endpoint,
    status: response.status,
    response: data
  });
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).success === false)) {
    throw new Error(`gpt-image2-vip 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (!extractImageUrls(data).length) {
    throw new Error("gpt-image2-vip 生成失败：API易未返回图片数据。");
  }
}

async function requestGeneration(config: ApiyiConfig, prompt: string, size: string) {
  const response = await fetch(config.generationUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      size,
      response_format: "b64_json"
    }),
    signal: AbortSignal.timeout(APIYI_IMAGE_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  assertApiyiResponse(response, data, "generate", config.generationUrl);
  return data;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  const results: T[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  });
  await Promise.all(workers);
  return results;
}

export async function generateWithApiyi(input: unknown) {
  const body = input && typeof input === "object" ? input as ApiyiInput : {};
  const config = apiyiConfig();
  const prompt = body.prompt?.trim() || "";
  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const size = imageSizeFromRatio(body.size);
  if (body.sourceImageUrls?.length) throw new Error("gpt-image2-vip 图生图尚未接入。");

  const tasks = Array.from({ length: requestedCount }, () => async () => {
    const billing = await reserveMainAppCredits({
      operation: "image-generate",
      providerId: "apiyi",
      model: config.model,
      media: true
    });
    try {
      const data = await requestGeneration(config, prompt, size);
      await billing.settleMedia();
      return data;
    } catch (error) {
      if (error instanceof MainAppBillingError) throw error;
      await billing.release();
      throw error;
    }
  });

  const results = await runWithConcurrency(tasks, MAX_PARALLEL_IMAGE_REQUESTS);
  const images = results.flatMap(extractImageUrls).slice(0, requestedCount).map((url, index) => ({
    id: `apiyi_${Date.now()}_${index}`,
    url,
    provider: "gpt-image2-vip" as const
  }));
  if (!images.length) throw new Error("gpt-image2-vip 生成失败：API易未返回图片数据。");

  return {
    provider: "gpt-image2-vip" as const,
    model: config.model,
    input: body,
    images
  };
}
