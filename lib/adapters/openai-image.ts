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
  projectCode: string;
  accessKey: string;
  secretKey: string;
  modelId: string;
  resolution: string;
};

const MAX_IMAGES_PER_RUN = 10;
const MAX_PARALLEL_IMAGE_REQUESTS = Math.max(1, Math.min(10, Number(process.env.OPENAI_IMAGE_PARALLEL_REQUESTS) || 4));
const MAX_RESPONSE_DEPTH = 6;
const RESPONSE_CONTAINER_KEYS = new Set(["data", "image", "images", "result", "results", "output", "outputs"]);
const IMAGE_URL_KEYS = new Set(["url", "imageurl", "image_url"]);
const IMAGE_BASE64_KEYS = new Set(["b64_json", "base64", "image_base64", "image_data"]);
export const IMAGE_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

function asRecord(input: unknown): ImageInput {
  return input && typeof input === "object" ? input as ImageInput : {};
}

function image2Config(): Image2Config {
  return {
    apiUrl: process.env.GPT_IMAGE2_API_URL || "http://14.103.147.238:19220/openApi/generate",
    projectCode: process.env.GPT_IMAGE2_PROJECT_CODE || "",
    accessKey: process.env.GPT_IMAGE2_ACCESS_KEY || "",
    secretKey: process.env.GPT_IMAGE2_SECRET_KEY || "",
    modelId: process.env.GPT_IMAGE2_MODEL_ID || "gpt-image2-low",
    resolution: process.env.GPT_IMAGE2_RESOLUTION || "1K"
  };
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

async function requestImage(config: Image2Config, prompt: string, scale: string) {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      projectCode: config.projectCode,
      "X-Access-Key": config.accessKey,
      "X-Secret-Key": config.secretKey
    },
    body: JSON.stringify({
      modelId: config.modelId,
      abilityType: "IMAGE",
      prompt,
      payload: {
        params: {
          resolution: config.resolution,
          scale
        }
      }
    }),
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });

  const data = await response.json().catch(() => ({}));
  logImageProviderResponse({
    provider: "Image 2.0",
    operation: "generate",
    endpoint: config.apiUrl,
    status: response.status,
    response: data
  });

  if (!response.ok) {
    throw new Error(`Image 2.0 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (data && typeof data === "object" && (data as Record<string, unknown>).success === false) {
    throw new Error(`Image 2.0 生成失败：${providerError(data, "服务商拒绝了请求")}`);
  }
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

  if (body.sourceImageUrls?.length) {
    throw new Error("Image 2.0 新接口暂不支持参考图编辑。");
  }

  const prompt = [
    "请生成真实摄影质感的图片，优先像手机或相机拍摄的真实产品图/生活场景图。避免假海报感、3D 渲染感、塑料质感、过度磨皮、卡通插画、AI 拼贴感和虚假品牌包装。光线自然，材质真实，产品边缘清晰。",
    body.prompt || "生成一张适合内容生产中台图文页面的真实图片。",
    body.sourceImages?.length ? `参考素材名称：${body.sourceImages.join("、")}` : ""
  ].filter(Boolean).join("\n");
  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const scale = imageScaleFromSize(body.size);
  const tasks = Array.from({ length: requestedCount }, () => () => requestImage(config, prompt, scale));
  const results = await runWithConcurrency(tasks, MAX_PARALLEL_IMAGE_REQUESTS);
  const images = results.flatMap(extractImageUrls).slice(0, requestedCount).map((url, index) => ({
    id: `image2_${Date.now()}_${index}`,
    url,
    provider: "Image 2.0"
  }));

  return {
    provider: "Image 2.0",
    model: config.modelId,
    input: body,
    images,
    raw: images.length ? undefined : results
  };
}

export async function regenerateSingleImage(input: unknown) {
  const result = await generateImage({ ...(asRecord(input)), count: 1 });
  return { ...result, image: Array.isArray(result.images) ? result.images[0] : imagePlans[0] };
}
