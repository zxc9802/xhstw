import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
import { MainAppBillingError, reserveMainAppCredits } from "@/lib/main-app-billing";

type OpenluxInput = {
  provider?: string;
  prompt?: string;
  size?: string;
  count?: number;
  sourceImageUrls?: string[];
};

type OpenluxConfig = {
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
export const OPENLUX_IMAGE_TIMEOUT_MS = 5 * 60 * 1000;

export function isOpenluxImageProvider(provider: string) {
  return provider === "gpt-image-2-c";
}

function asRecord(input: unknown): OpenluxInput {
  return input && typeof input === "object" ? input as OpenluxInput : {};
}

function imageSizeFromRatio(ratio = "1:1") {
  const value = ratio.trim().toLowerCase();
  return ({
    "1:1": "1024x1024",
    "3:4": "1024x1536",
    "4:3": "1536x1024",
    "9:16": "1024x1792",
    "16:9": "1792x1024"
  } as Record<string, string>)[value] || (/^\d+x\d+$/.test(value) ? value : "1024x1024");
}

function extractImageUrls(input: unknown) {
  const urls: string[] = [];

  function visit(value: unknown, key: string, depth: number) {
    if (depth > MAX_RESPONSE_DEPTH || value === null || value === undefined) return;
    const normalizedKey = key.toLowerCase();

    if (typeof value === "string") {
      if (IMAGE_BASE64_KEYS.has(normalizedKey)) {
        if (value.startsWith("data:image/")) urls.push(value);
        else if (value) urls.push(`data:image/jpeg;base64,${value}`);
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
      if (!RESPONSE_CONTAINER_KEYS.has(normalizedKey)) return;
      value.forEach((item) => visit(item, normalizedKey, depth + 1));
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
  if (!data || typeof data === "object") {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    for (const key of ["msg", "message", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") return JSON.stringify(value);
    }
  }
  return fallback;
}

function openluxConfig(): OpenluxConfig {
  const apiKey = process.env.OPENLUX_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("gpt-image-2-c 配置缺失：OPENLUX_API_KEY");
  const generationUrl = process.env.OPENLUX_IMAGE_URL?.trim() || "https://api.openlux.ai/v1/images/generations";
  return {
    apiKey,
    generationUrl,
    editUrl: process.env.OPENLUX_IMAGE_EDIT_URL?.trim() || generationUrl.replace(/\/generations\/?$/, "/edits"),
    model: process.env.OPENLUX_IMAGE_MODEL?.trim() || "gpt-image-2-c"
  };
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return { mime, ext, buffer: Buffer.from(match[2], "base64") };
}

async function imageUrlToBlob(url: string, index: number) {
  const parsed = parseDataUrl(url);
  if (parsed) {
    return {
      blob: new Blob([parsed.buffer], { type: parsed.mime }),
      fileName: `reference-${index + 1}.${parsed.ext}`
    };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`参考图下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    fileName: `reference-${index + 1}.${ext}`
  };
}

function assertOpenluxResponse(response: Response, data: unknown, operation: "generate" | "edit", endpoint: string) {
  logImageProviderResponse({
    provider: "gpt-image-2-c",
    operation,
    endpoint,
    status: response.status,
    response: data
  });
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).success === false)) {
    throw new Error(`gpt-image-2-c 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (!extractImageUrls(data).length) throw new Error("gpt-image-2-c 生成失败：响应未返回图片。");
}

async function requestGeneration(config: OpenluxConfig, prompt: string, size: string) {
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
      size
    }),
    signal: AbortSignal.timeout(OPENLUX_IMAGE_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  assertOpenluxResponse(response, data, "generate", config.generationUrl);
  return data;
}

async function requestEdit(config: OpenluxConfig, prompt: string, size: string, sourceImageUrls: string[]) {
  const form = new FormData();
  form.append("model", config.model);
  form.append("prompt", prompt);
  form.append("size", size);
  const images = await Promise.all(sourceImageUrls.map(imageUrlToBlob));
  images.forEach(({ blob, fileName }) => form.append("image", blob, fileName));

  const response = await fetch(config.editUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(OPENLUX_IMAGE_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  assertOpenluxResponse(response, data, "edit", config.editUrl);
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

export async function generateWithOpenlux(input: unknown) {
  const body = asRecord(input);
  const config = openluxConfig();
  const prompt = body.prompt?.trim() || "";
  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const size = imageSizeFromRatio(body.size);
  const sourceImageUrls = body.sourceImageUrls ?? [];

  const tasks = Array.from({ length: requestedCount }, () => async () => {
    const billing = await reserveMainAppCredits({
      operation: "image-generate",
      providerId: "openlux",
      model: config.model,
      media: true
    });
    try {
      const data = sourceImageUrls.length
        ? await requestEdit(config, prompt, size, sourceImageUrls)
        : await requestGeneration(config, prompt, size);
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
    id: `openlux_${Date.now()}_${index}`,
    url,
    provider: "gpt-image-2-c" as const
  }));
  if (!images.length) throw new Error("gpt-image-2-c 生成失败：服务商未返回图片地址。");

  return {
    provider: "gpt-image-2-c" as const,
    model: config.model,
    input: body,
    images
  };
}
