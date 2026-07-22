import { imagePlans } from "@/lib/mock/data";
import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";

type ImageInput = {
  provider?: string;
  prompt?: string;
  size?: string;
  count?: number;
  plan?: { page?: number; type?: string; title?: string; copy?: string };
  sourceImages?: string[];
  sourceImageUrls?: string[];
};

type Image2Config = {
  apiUrl: string;
  queryUrl: string;
  projectCode: string;
  accessKey: string;
  secretKey: string;
  modelId: string;
  resolution: string;
  pollIntervalMs: number;
  pollMaxAttempts: number;
};

type YunwuImageConfig = {
  apiKey: string;
  generationUrl: string;
  editUrl: string;
  model: string;
  format: string;
};

type ImageRequestResult = {
  data: unknown;
  provider: "Image 2.0" | "Image 2.0 (Yunwu fallback)";
  model: string;
};

const MAX_IMAGES_PER_RUN = 10;
const MAX_PARALLEL_IMAGE_REQUESTS = Math.max(1, Math.min(10, Number(process.env.OPENAI_IMAGE_PARALLEL_REQUESTS) || 4));
const PRIMARY_IMAGE_ATTEMPTS = 4;
const MAX_RESPONSE_DEPTH = 6;
const RESPONSE_CONTAINER_KEYS = new Set([
  "content",
  "data",
  "image",
  "images",
  "message",
  "resource_urls",
  "resourceurls",
  "result",
  "results",
  "output",
  "outputs"
]);
const IMAGE_URL_KEYS = new Set(["url", "imageurl", "image_url"]);
const IMAGE_BASE64_KEYS = new Set(["b64_json", "base64", "image_base64", "image_data"]);
export const IMAGE_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

function asRecord(input: unknown): ImageInput {
  return input && typeof input === "object" ? input as ImageInput : {};
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function image2Config(): Image2Config {
  const apiUrl = process.env.GPT_IMAGE2_API_URL || "http://14.103.147.238:19220/openApi/generate";
  return {
    apiUrl,
    queryUrl: process.env.GPT_IMAGE2_QUERY_URL || apiUrl.replace(/\/generate\/?$/, "/queryResult"),
    projectCode: process.env.GPT_IMAGE2_PROJECT_CODE || "",
    accessKey: process.env.GPT_IMAGE2_ACCESS_KEY || "",
    secretKey: process.env.GPT_IMAGE2_SECRET_KEY || "",
    modelId: process.env.GPT_IMAGE2_MODEL_ID || "gpt-image2-low",
    resolution: process.env.GPT_IMAGE2_RESOLUTION || "1K",
    pollIntervalMs: boundedInteger(process.env.GPT_IMAGE2_POLL_INTERVAL_MS, 3000, 0, 60000),
    pollMaxAttempts: boundedInteger(process.env.GPT_IMAGE2_POLL_MAX_ATTEMPTS, 100, 1, 600)
  };
}

function yunwuImageConfig(): YunwuImageConfig {
  const generationUrl = process.env.YUNWU_IMAGE_URL || "https://yunwu.ai/v1/images/generations";
  return {
    apiKey: process.env.YUNWU_API_KEY || "",
    generationUrl,
    editUrl: process.env.YUNWU_IMAGE_EDIT_URL || generationUrl.replace(/\/generations\/?$/, "/edits"),
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    format: process.env.OPENAI_IMAGE_FORMAT || "jpeg"
  };
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

export function imageScaleFromSize(size = "1:1") {
  const value = size.trim().toLowerCase();
  if (["1:1", "3:4", "4:3", "9:16", "16:9"].includes(value)) return value;
  return ({
    "1024x1024": "1:1",
    "1024x1536": "3:4",
    "1536x1024": "4:3",
    "1024x1792": "9:16",
    "1792x1024": "16:9"
  } as Record<string, string>)[value] || "1:1";
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
      const imageContext = IMAGE_URL_KEYS.has(normalizedKey) || RESPONSE_CONTAINER_KEYS.has(normalizedKey);
      if (imageContext && (/^https?:\/\//i.test(value) || value.startsWith("data:image/"))) urls.push(value);
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
      if (key.toLowerCase() === "taskid" && (typeof childValue === "string" || typeof childValue === "number")) {
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
  function visit(value: unknown, depth: number): { status: number; message?: string } | undefined {
    if (depth > MAX_RESPONSE_DEPTH || !value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const status = typeof record.status === "number" || typeof record.status === "string"
      ? Number(record.status)
      : Number.NaN;
    if (Number.isInteger(status)) {
      return {
        status,
        message: typeof record.message === "string" && record.message.trim() ? record.message : undefined
      };
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

function mockImages(input: ImageInput) {
  const count = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(input.count) || 1));
  const images = Array.from({ length: count }, (_, index) => ({
    ...imagePlans[index % imagePlans.length],
    id: `mock_image2_${Date.now()}_${index}`
  }));
  return { provider: "mock", input, images };
}

function providerError(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  for (const key of ["msg", "message", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") return JSON.stringify(value);
  }
  return fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerHeaders(config: Image2Config) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    projectCode: config.projectCode,
    "X-Access-Key": config.accessKey,
    "X-Secret-Key": config.secretKey
  };
}

function assertProviderResponse(response: Response, data: unknown, operation: "generate" | "query", endpoint: string) {
  logImageProviderResponse({
    provider: "Image 2.0",
    operation,
    endpoint,
    status: response.status,
    response: data
  });
  if (!response.ok) {
    throw new Error(`Image 2.0 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (data && typeof data === "object" && (data as Record<string, unknown>).success === false) {
    throw new Error(`Image 2.0 生成失败：${providerError(data, "服务商拒绝了请求")}`);
  }
}

function waitForNextPoll(milliseconds: number) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function queryImageTask(config: Image2Config, taskId: string) {
  for (let attempt = 0; attempt < config.pollMaxAttempts; attempt += 1) {
    const response = await fetch(config.queryUrl, {
      method: "POST",
      headers: providerHeaders(config),
      body: JSON.stringify({ taskId, abilityType: "IMAGE" }),
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    assertProviderResponse(response, data, "query", config.queryUrl);

    const state = extractTaskState(data);
    if (!state) throw new Error(`Image 2.0 查询失败：任务 ${taskId} 的响应缺少 status。`);
    if (state.status === 2) {
      if (!extractImageUrls(data).length) {
        throw new Error(`Image 2.0 查询失败：任务 ${taskId} 已完成，但未返回图片地址。`);
      }
      return data;
    }
    if (state.status === 3) {
      throw new Error(`Image 2.0 生成失败：${state.message || `任务 ${taskId} 执行失败`}`);
    }
    if (state.status === 4) {
      throw new Error(`Image 2.0 生成失败：${state.message || `任务 ${taskId} 已取消`}`);
    }
    if (state.status !== 0 && state.status !== 1) {
      throw new Error(`Image 2.0 查询失败：任务 ${taskId} 返回未知状态 ${state.status}。`);
    }
    if (attempt + 1 < config.pollMaxAttempts) await waitForNextPoll(config.pollIntervalMs);
  }

  throw new Error(`Image 2.0 生成超时：任务 ${taskId} 在限定次数内未完成。`);
}

async function requestImage(
  config: Image2Config,
  prompt: string,
  scale: string,
  sourceImageUrls: string[]
) {
  const payload: Record<string, unknown> = {
    params: {
      resolution: config.resolution,
      scale
    }
  };
  if (sourceImageUrls.length) payload.resources = sourceImageUrls;

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: providerHeaders(config),
    body: JSON.stringify({
      modelId: config.modelId,
      abilityType: "IMAGE",
      prompt,
      payload
    }),
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });

  const data = await response.json().catch(() => ({}));
  assertProviderResponse(response, data, "generate", config.apiUrl);
  if (extractImageUrls(data).length) return data;

  const taskId = extractTaskId(data);
  if (taskId) return queryImageTask(config, taskId);
  throw new Error("Image 2.0 生成失败：响应未返回图片或 taskId。");
}

async function requestCurrentImageWithRetries(
  config: Image2Config,
  prompt: string,
  scale: string,
  sourceImageUrls: string[]
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < PRIMARY_IMAGE_ATTEMPTS; attempt += 1) {
    try {
      return await requestImage(config, prompt, scale, sourceImageUrls);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function requestYunwuGeneration(config: YunwuImageConfig, prompt: string, size: string) {
  if (!config.apiKey) throw new Error("未配置 YUNWU_API_KEY");
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
      n: 1,
      size,
      quality: "high",
      format: config.format
    }),
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  logImageProviderResponse({
    provider: "Image 2.0 (Yunwu fallback)",
    operation: "generate",
    endpoint: config.generationUrl,
    status: response.status,
    response: data
  });
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).success === false)) {
    throw new Error(`Yunwu Image 2.0 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (!extractImageUrls(data).length) throw new Error("Yunwu Image 2.0 生成失败：响应未返回图片。");
  return data;
}

async function requestImageWithFallback(
  config: Image2Config,
  yunwuConfig: YunwuImageConfig,
  body: ImageInput,
  prompt: string,
  scale: string
): Promise<ImageRequestResult> {
  const sourceImageUrls = body.sourceImageUrls ?? [];
  try {
    return {
      data: await requestCurrentImageWithRetries(config, prompt, scale, sourceImageUrls),
      provider: "Image 2.0",
      model: config.modelId
    };
  } catch (primaryError) {
    try {
      return {
        data: await requestYunwuGeneration(yunwuConfig, prompt, imageSizeFromRatio(body.size)),
        provider: "Image 2.0 (Yunwu fallback)",
        model: yunwuConfig.model
      };
    } catch (fallbackError) {
      throw new Error(
        `Image 2.0 当前接口重试 3 次后仍失败：${errorMessage(primaryError)}；Yunwu 兜底失败：${errorMessage(fallbackError)}`
      );
    }
  }
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

export async function generateImage(input: unknown) {
  const body = asRecord(input);
  if (body.provider?.includes("仅生成提示词")) return mockImages(body);

  const config = image2Config();
  if (
    process.env.IMAGE_MODEL_PROVIDER === "mock"
    || !config.projectCode
    || !config.accessKey
    || !config.secretKey
  ) {
    return mockImages(body);
  }

  const prompt = [
    "请生成真实摄影质感的图片，优先像手机或相机拍摄的真实产品图/生活场景图。避免假海报感、3D 渲染感、塑料质感、过度磨皮、卡通插画、AI 拼贴感和虚假品牌包装。光线自然，材质真实，产品边缘清晰。",
    body.prompt || "生成一张适合内容生产中台图文页面的真实图片。",
    body.sourceImages?.length ? `参考素材名称：${body.sourceImages.join("、")}` : "",
    body.sourceImageUrls?.length
      ? "已随请求传入参考图。请严格按用户提示处理参考图关系，只修改指定对象，其他构图、背景、文字位置、光线和风格尽量保持不变。"
      : ""
  ].filter(Boolean).join("\n");
  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const scale = imageScaleFromSize(body.size);
  const yunwuConfig = yunwuImageConfig();
  const tasks = Array.from(
    { length: requestedCount },
    () => () => requestImageWithFallback(config, yunwuConfig, body, prompt, scale)
  );
  const results = await runWithConcurrency(tasks, MAX_PARALLEL_IMAGE_REQUESTS);
  const images = results.flatMap((result) => extractImageUrls(result.data).map((url) => ({
    url,
    provider: result.provider
  }))).slice(0, requestedCount).map((image, index) => ({
    id: `image2_${Date.now()}_${index}`,
    ...image
  }));

  return {
    provider: "Image 2.0",
    model: config.modelId,
    input: body,
    images,
    raw: images.length ? undefined : results.map((result) => result.data)
  };
}

export async function regenerateSingleImage(input: unknown) {
  const result = await generateImage({ ...(asRecord(input)), count: 1 });
  return { ...result, image: Array.isArray(result.images) ? result.images[0] : imagePlans[0] };
}
