import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";

type NanobananaNewInput = {
  prompt?: string;
  size?: string;
  count?: number;
  sourceImageUrls?: string[];
};

type NanobananaNewConfig = {
  apiUrl: string;
  queryUrl: string;
  projectCode: string;
  accessKey: string;
  secretKey: string;
  modelId: string;
  pollIntervalMs: number;
  pollMaxAttempts: number;
};

const MAX_IMAGES_PER_RUN = 10;
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
const TASK_ID_KEYS = new Set(["taskid", "task_id"]);
export const NANOBANANA_NEW_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function asRecord(input: unknown): NanobananaNewInput {
  return input && typeof input === "object" ? input as NanobananaNewInput : {};
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function providerConfig(): NanobananaNewConfig {
  const values = {
    IMAGE_AGGREGATION_API_BASE_URL: process.env.IMAGE_AGGREGATION_API_BASE_URL?.trim() || "",
    IMAGE_AGGREGATION_PROJECT_CODE: process.env.IMAGE_AGGREGATION_PROJECT_CODE?.trim() || "",
    IMAGE_AGGREGATION_ACCESS_KEY: process.env.IMAGE_AGGREGATION_ACCESS_KEY?.trim() || "",
    IMAGE_AGGREGATION_SECRET_KEY: process.env.IMAGE_AGGREGATION_SECRET_KEY?.trim() || ""
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`nanobanan新配置缺失：${missing.join("、")}`);
  }

  const baseUrl = stripTrailingSlash(values.IMAGE_AGGREGATION_API_BASE_URL);
  return {
    apiUrl: `${baseUrl}/openApi/generate`,
    queryUrl: `${baseUrl}/openApi/queryResult`,
    projectCode: values.IMAGE_AGGREGATION_PROJECT_CODE,
    accessKey: values.IMAGE_AGGREGATION_ACCESS_KEY,
    secretKey: values.IMAGE_AGGREGATION_SECRET_KEY,
    modelId: process.env.NANOBANANA_NEW_MODEL_ID?.trim() || "gemini-3.1-flash-image-preview",
    pollIntervalMs: boundedInteger(process.env.NANOBANANA_NEW_POLL_INTERVAL_MS, 3000, 0, 60000),
    pollMaxAttempts: boundedInteger(process.env.NANOBANANA_NEW_POLL_MAX_ATTEMPTS, 100, 1, 600)
  };
}

function providerHeaders(config: NanobananaNewConfig) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    projectCode: config.projectCode,
    "X-Access-Key": config.accessKey,
    "X-Secret-Key": config.secretKey
  };
}

function imageScaleFromSize(size = "1:1") {
  const value = size.trim().toLowerCase();
  if (["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"].includes(value)) {
    return value;
  }
  return ({
    "1024x1024": "1:1",
    "1024x1536": "3:4",
    "1536x1024": "4:3",
    "1024x1792": "9:16",
    "1792x1024": "16:9"
  } as Record<string, string>)[value] || "1:1";
}

function imagePrompt(input: NanobananaNewInput) {
  return input.prompt?.trim() || "";
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

function extractTaskId(input: unknown) {
  function visit(value: unknown, depth: number): string | undefined {
    if (depth > MAX_RESPONSE_DEPTH || !value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }

    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (TASK_ID_KEYS.has(key.toLowerCase()) && (typeof childValue === "string" || typeof childValue === "number")) {
        const taskId = String(childValue).trim();
        if (taskId) return taskId;
      }
    }
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (RESPONSE_CONTAINER_KEYS.has(key.toLowerCase())) {
        const found = visit(childValue, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }

  return visit(input, 0);
}

function extractTaskState(input: unknown) {
  function visit(value: unknown, depth: number): { status: string | number; message?: string } | undefined {
    if (depth > MAX_RESPONSE_DEPTH || !value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.status === "number" || typeof record.status === "string") {
      const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : record.status;
      if (status !== "") {
        return {
          status,
          message: providerMessage(record)
        };
      }
    }
    for (const [key, childValue] of Object.entries(record)) {
      if (RESPONSE_CONTAINER_KEYS.has(key.toLowerCase())) {
        const found = visit(childValue, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }

  return visit(input, 0);
}

function providerMessage(input: unknown, depth = 0): string | undefined {
  if (depth > MAX_RESPONSE_DEPTH || !input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["msg", "message", "errorMsg", "error_message", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const [key, value] of Object.entries(record)) {
    if (RESPONSE_CONTAINER_KEYS.has(key.toLowerCase())) {
      const found = providerMessage(value, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function assertProviderResponse(
  response: Response,
  data: unknown,
  operation: "generate" | "query",
  endpoint: string
) {
  logImageProviderResponse({
    provider: "nanobanan新",
    operation,
    endpoint,
    status: response.status,
    response: data
  });
  if (!response.ok) {
    throw new Error(`nanobanan新生成失败：${providerMessage(data) || `HTTP ${response.status}`}`);
  }
  if (data && typeof data === "object" && (data as Record<string, unknown>).success === false) {
    throw new Error(`nanobanan新生成失败：${providerMessage(data) || "服务商拒绝了请求"}`);
  }
}

async function waitForNextPoll(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function queryImageTask(config: NanobananaNewConfig, taskId: string) {
  for (let attempt = 0; attempt < config.pollMaxAttempts; attempt += 1) {
    const response = await fetch(config.queryUrl, {
      method: "POST",
      headers: providerHeaders(config),
      body: JSON.stringify({ taskId, abilityType: "IMAGE" }),
      signal: AbortSignal.timeout(NANOBANANA_NEW_REQUEST_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    assertProviderResponse(response, data, "query", config.queryUrl);

    const state = extractTaskState(data);
    if (!state) throw new Error(`nanobanan新查询失败：任务 ${taskId} 的响应缺少 status。`);
    if ([2, "2", "succeeded", "success", "completed", "complete"].includes(state.status)) {
      if (!extractImageUrls(data).length) {
        throw new Error(`nanobanan新查询失败：任务 ${taskId} 已完成，但未返回图片地址。`);
      }
      return data;
    }
    if ([3, "3", "failed", "failure", "error"].includes(state.status)) {
      throw new Error(`nanobanan新生成失败：${state.message || `任务 ${taskId} 执行失败`}`);
    }
    if ([4, "4", "cancelled", "canceled"].includes(state.status)) {
      throw new Error(`nanobanan新生成失败：${state.message || `任务 ${taskId} 已取消`}`);
    }
    if (![0, 1, "0", "1", "queued", "pending", "processing", "running", "submitted"].includes(state.status)) {
      throw new Error(`nanobanan新查询失败：任务 ${taskId} 返回未知状态 ${state.status}。`);
    }
    if (attempt + 1 < config.pollMaxAttempts) await waitForNextPoll(config.pollIntervalMs);
  }

  throw new Error(`nanobanan新生成超时：任务 ${taskId} 在限定次数内未完成。`);
}

async function requestImage(config: NanobananaNewConfig, input: NanobananaNewInput) {
  const sourceImageUrls = Array.isArray(input.sourceImageUrls)
    ? input.sourceImageUrls.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const payload: Record<string, unknown> = {
    params: {
      resolution: "1K",
      scale: imageScaleFromSize(input.size)
    }
  };
  if (sourceImageUrls.length) payload.resources = sourceImageUrls;

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: providerHeaders(config),
    body: JSON.stringify({
      modelId: config.modelId,
      abilityType: "IMAGE",
      prompt: imagePrompt(input),
      payload
    }),
    signal: AbortSignal.timeout(NANOBANANA_NEW_REQUEST_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  assertProviderResponse(response, data, "generate", config.apiUrl);
  if (extractImageUrls(data).length) return data;

  const taskId = extractTaskId(data);
  if (!taskId) throw new Error("nanobanan新生成失败：响应未返回图片或 taskId。");
  return queryImageTask(config, taskId);
}

export async function generateWithNanobananaNew(input: unknown) {
  const body = asRecord(input);
  const config = providerConfig();
  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const results = await Promise.all(
    Array.from({ length: requestedCount }, () => requestImage(config, body))
  );
  const images = results
    .flatMap(extractImageUrls)
    .slice(0, requestedCount)
    .map((url, index) => ({
      id: `nanobanana_new_${Date.now()}_${index}`,
      url,
      provider: "nanobanan新" as const
    }));
  if (!images.length) throw new Error("nanobanan新生成失败：服务商未返回图片地址。");

  return {
    provider: "nanobanan新" as const,
    model: config.modelId,
    input: body,
    images
  };
}
