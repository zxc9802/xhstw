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

const YUNWU_IMAGE_URL = process.env.YUNWU_IMAGE_URL || "https://yunwu.ai/v1/images/generations";
const YUNWU_IMAGE_EDIT_URL = process.env.YUNWU_IMAGE_EDIT_URL || YUNWU_IMAGE_URL.replace(/\/generations\/?$/, "/edits");
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const MAX_IMAGES_PER_REQUEST = 4;
const MAX_IMAGES_PER_RUN = 10;
const MAX_PARALLEL_IMAGE_REQUESTS = Math.max(1, Math.min(10, Number(process.env.OPENAI_IMAGE_PARALLEL_REQUESTS) || 4));
export const IMAGE_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

function asRecord(input: unknown): ImageInput {
  return input && typeof input === "object" ? input as ImageInput : {};
}

export function imageSizeFromRatio(ratio = "1:1") {
  const value = ratio.trim();
  if (value === "3:4") return "1024x1536";
  if (value === "9:16") return "1024x1792";
  if (value === "4:3") return "1536x1024";
  if (value === "16:9") return "1792x1024";
  if (/^\d+x\d+$/i.test(value)) return value.toLowerCase();
  return "1024x1024";
}

function extractImageUrls(data: unknown): string[] {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(record.images) ? record.images : [];
  return rows.flatMap((item) => {
    if (typeof item === "string") return [item];
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (typeof row.url === "string") return [row.url];
    if (typeof row.b64_json === "string") return [`data:image/jpeg;base64,${row.b64_json}`];
    if (typeof row.base64 === "string") return [`data:image/jpeg;base64,${row.base64}`];
    return [];
  });
}

function mockImages(input: ImageInput) {
  const count = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(input.count) || 1));
  const images = Array.from({ length: count }, (_, index) => ({
    ...imagePlans[index % imagePlans.length],
    id: `mock_image2_${Date.now()}_${index}`
  }));
  return { provider: "mock", input, images };
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

async function generateImageEdit(body: ImageInput, apiKey: string, promptParts: string[], count: number) {
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", [
    ...promptParts,
    "这是基于参考图的图片编辑任务，不是重新生成新产品。必须保留原产品本体、品牌文字、瓶身/包装形状、比例、透视、材质和主体位置；除用户明确要求修改的背景或局部元素外，其他都不变。"
  ].join("\n"));
  form.append("n", String(Math.max(1, Math.min(MAX_IMAGES_PER_REQUEST, count))));
  form.append("size", imageSizeFromRatio(body.size));
  form.append("quality", "high");

  const sourceUrls = body.sourceImageUrls ?? [];
  const blobs = await Promise.all(sourceUrls.map((url, index) => imageUrlToBlob(url, index)));
  blobs.forEach(({ blob, fileName }) => {
    form.append("image", blob, fileName);
  });

  const response = await fetch(YUNWU_IMAGE_EDIT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  logImageProviderResponse({
    provider: "Image 2.0",
    operation: "edit",
    endpoint: YUNWU_IMAGE_EDIT_URL,
    status: response.status,
    response: data
  });
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? JSON.stringify((data as { error: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(`Image 2.0 编辑失败：${error}`);
  }

  return data;
}

async function generateImageBatch(payload: Record<string, unknown>, apiKey: string) {
  const response = await fetch(YUNWU_IMAGE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });

  const data = await response.json().catch(() => ({}));
  logImageProviderResponse({
    provider: "Image 2.0",
    operation: "generate",
    endpoint: YUNWU_IMAGE_URL,
    status: response.status,
    response: data
  });
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? JSON.stringify((data as { error: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(`Image 2.0 生成失败：${error}`);
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

async function collectImageResults(
  requestedCount: number,
  runBatch: (count: number) => Promise<unknown>,
  batchSizes: number[]
) {
  const results: unknown[] = [];
  const runTasks = (sizes: number[]) => runWithConcurrency(
    sizes.map((batchCount) => async () => runBatch(batchCount)),
    MAX_PARALLEL_IMAGE_REQUESTS
  );

  results.push(...await runTasks(batchSizes));

  let imageCount = results.flatMap(extractImageUrls).length;
  let extraAttempts = 0;
  while (imageCount < requestedCount && extraAttempts < requestedCount) {
    const missing = requestedCount - imageCount;
    const extraSizes = Array.from({ length: missing }, () => 1);
    results.push(...await runTasks(extraSizes));
    imageCount = results.flatMap(extractImageUrls).length;
    extraAttempts += missing;
  }

  return results;
}

export async function generateImage(input: unknown) {
  const body = asRecord(input);
  if (body.provider?.includes("仅生成提示词")) return mockImages(body);

  const apiKey = process.env.OPENAI_IMAGE_API_KEY || process.env.YUNWU_API_KEY;
  if (!apiKey || process.env.IMAGE_MODEL_PROVIDER === "mock") return mockImages(body);

  const promptParts = [
    "请生成真实摄影质感的图片，优先像手机或相机拍摄的真实产品图/生活场景图。避免假海报感、3D 渲染感、塑料质感、过度磨皮、卡通插画、AI 拼贴感和虚假品牌包装。光线自然，材质真实，产品边缘清晰。",
    body.prompt || "生成一张适合内容生产中台图文页面的真实图片。",
    body.sourceImages?.length ? `参考素材名称：${body.sourceImages.join("、")}` : "",
    body.sourceImageUrls?.length
      ? "已随请求传入参考图。请严格按用户提示处理参考图关系：如果用户要求背景不变、仅替换产品、图一换图二等，只修改指定对象，其他构图、背景、文字位置、光线和风格尽量保持不变。参考图是真实图时，生成结果也必须保持真实摄影质感。"
      : ""
  ].filter(Boolean);

  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const payload: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt: promptParts.join("\n"),
    size: imageSizeFromRatio(body.size),
    quality: "high",
    format: process.env.OPENAI_IMAGE_FORMAT || "jpeg"
  };

  if (body.sourceImageUrls?.length) {
    payload.reference_images = body.sourceImageUrls;
    payload.images = body.sourceImageUrls;
  }

  let remaining = requestedCount;
  if (body.sourceImageUrls?.length) {
    const editBatchSizes = Array.from({ length: requestedCount }, () => 1);
    const results = await collectImageResults(requestedCount, (batchCount) => generateImageEdit(body, apiKey, promptParts, batchCount), editBatchSizes);
    const images = results.flatMap(extractImageUrls).slice(0, requestedCount).map((url, index) => ({
      id: `image2_${Date.now()}_${index}`,
      url,
      provider: "Image 2.0"
    }));
    return { provider: "Image 2.0", model: IMAGE_MODEL, input: body, images, raw: images.length ? undefined : results };
  } else {
    const batchSizes: number[] = [];
    while (remaining > 0) {
      const batchCount = Math.min(MAX_IMAGES_PER_REQUEST, remaining);
      batchSizes.push(batchCount);
      remaining -= batchCount;
    }
    const results = await collectImageResults(requestedCount, (batchCount) => generateImageBatch({ ...payload, n: batchCount }, apiKey), batchSizes);
    const images = results.flatMap(extractImageUrls).slice(0, requestedCount).map((url, index) => ({
      id: `image2_${Date.now()}_${index}`,
      url,
      provider: "Image 2.0"
    }));
    return { provider: "Image 2.0", model: IMAGE_MODEL, input: body, images, raw: images.length ? undefined : results };
  }
}

export async function regenerateSingleImage(input: unknown) {
  const result = await generateImage({ ...(asRecord(input)), count: 1 });
  return { ...result, image: Array.isArray(result.images) ? result.images[0] : imagePlans[0] };
}
