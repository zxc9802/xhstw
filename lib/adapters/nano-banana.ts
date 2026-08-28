import { imagePlans } from "@/lib/mock/data";
import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
import { MainAppBillingError, reserveMainAppCredits } from "@/lib/main-app-billing";

type NanoBananaInput = {
  provider?: string;
  prompt?: string;
  size?: string;
  count?: number;
  plan?: { page?: number; type?: string; title?: string; copy?: string };
  sourceImages?: string[];
  sourceImageUrls?: string[];
};

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { fileUri: string; mimeType?: string };
};

const NANO_BANANA_MODEL = process.env.NANO_BANANA_MODEL || "gemini-3.1-flash-image";
const DEFAULT_NANO_BANANA_API_URL = `https://api.openlux.ai/v1beta/models/${NANO_BANANA_MODEL}:generateContent`;
export const NANO_BANANA_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function nanoBananaApiUrl() {
  return process.env.NANO_BANANA_API_URL?.trim() || DEFAULT_NANO_BANANA_API_URL;
}

function nanoBananaApiKey() {
  return process.env.NANO_BANANA_API_KEY?.trim()
    || process.env.OPENLUX_API_KEY?.trim()
    || process.env.YUNWU_API_KEY?.trim()
    || "";
}

function asRecord(input: unknown): NanoBananaInput {
  return input && typeof input === "object" ? input as NanoBananaInput : {};
}

function imageAspectRatio(size = "1:1") {
  const value = size.trim().toLowerCase();
  if (["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"].includes(value)) {
    return value;
  }
  return ({
    "1024x1024": "1:1",
    "1080x1080": "1:1",
    "1024x1536": "3:4",
    "1080x1440": "3:4",
    "1536x1024": "4:3",
    "1440x1080": "4:3",
    "1024x1792": "9:16",
    "1080x1920": "9:16",
    "1792x1024": "16:9",
    "1920x1080": "16:9"
  } as Record<string, string>)[value] || "1:1";
}

function inlineDataUrl(record: Record<string, unknown>) {
  const data = record.data;
  const mime = record.mimeType || record.mime_type;
  if (typeof data !== "string" || !data) return undefined;
  if (typeof mime === "string" && mime.startsWith("image/")) {
    return data.startsWith("data:image/") ? data : `data:${mime};base64,${data}`;
  }
  return undefined;
}

function flattenImageUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (/^https?:\/\//.test(text) || text.startsWith("data:image/")) return [text];
    try {
      return flattenImageUrls(JSON.parse(text));
    } catch {
      const dataUrls = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) ?? [];
      const remoteUrls = text.match(/https?:\/\/[^\s"'<>)]*/g)?.filter((url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || /image|img|file|cdn|oss|cos|yunwu|openlux/i.test(url)) ?? [];
      return [...dataUrls, ...remoteUrls];
    }
  }
  if (Array.isArray(value)) return value.flatMap(flattenImageUrls);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const selfInline = inlineDataUrl(record);
    if (selfInline) return [selfInline];
    const nestedImageUrl = record.image_url && typeof record.image_url === "object" ? (record.image_url as Record<string, unknown>).url : undefined;
    const nestedInline = inlineDataUrl((record.inlineData || record.inline_data || {}) as Record<string, unknown>);
    const candidates = [
      nestedInline,
      record.url,
      record.image_url,
      nestedImageUrl,
      record.image,
      record.imageUrl,
      record.b64_json ? `data:image/jpeg;base64,${record.b64_json}` : undefined,
      record.base64 ? `data:image/jpeg;base64,${record.base64}` : undefined,
      record.candidates,
      record.parts,
      record.images,
      record.generated_images,
      record.output,
      record.outputs,
      record.artifacts,
      record.content,
      record.message,
      record.choices
    ];
    return candidates.flatMap(flattenImageUrls);
  }
  return [];
}

function referenceParts(urls: string[]): GeminiPart[] {
  return urls.flatMap((url) => {
    const trimmed = url.trim();
    if (!trimmed) return [];
    const dataUrl = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
    if (dataUrl) {
      return [{ inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } }];
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return [{ fileData: { fileUri: trimmed } }];
    }
    return [];
  });
}

function mockImages(input: NanoBananaInput) {
  const count = Math.max(1, Math.min(10, Number(input.count) || 1));
  const images = Array.from({ length: count }, (_, index) => ({
    ...imagePlans[index % imagePlans.length],
    id: `mock_nano_${Date.now()}_${index}`
  }));
  return { provider: "mock", input, images };
}

export async function generateWithNanoBanana(input: unknown) {
  const body = asRecord(input);
  if (body.provider?.includes("仅生成提示词")) return mockImages(body);

  const apiKey = nanoBananaApiKey();
  if (!apiKey || process.env.IMAGE_MODEL_PROVIDER === "mock") return mockImages(body);

  const prompt = body.prompt?.trim() || "";
  const endpoint = nanoBananaApiUrl();
  const requestBody = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        ...referenceParts(body.sourceImageUrls ?? [])
      ] satisfies GeminiPart[]
    }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: imageAspectRatio(body.size) }
    }
  };

  const requestOne = async () => fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(NANO_BANANA_REQUEST_TIMEOUT_MS)
  });

  const count = Math.max(1, Math.min(10, Number(body.count) || 1));
  const results = await Promise.allSettled(Array.from({ length: count }, async () => {
    const billing = await reserveMainAppCredits({
      operation: "image-generate",
      providerId: "yunwu",
      model: NANO_BANANA_MODEL,
      media: true,
    });
    try {
      const response = await requestOne();
      const data = await response.json().catch(() => ({}));
      logImageProviderResponse({
        provider: "Nano Banana 2",
        operation: "generate",
        endpoint,
        status: response.status,
        response: data
      });
      if (!response.ok) {
        const error = data && typeof data === "object" && "error" in data ? JSON.stringify((data as { error: unknown }).error) : `HTTP ${response.status}`;
        throw new Error(`Nano Banana 2 生成失败：${error}`);
      }
      await billing.settleMedia();
      return data;
    } catch (error) {
      if (error instanceof MainAppBillingError) throw error;
      await billing.release();
      throw error;
    }
  }));

  const successfulResults = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const warnings = results.flatMap((result, index) => result.status === "rejected"
    ? [`第 ${index + 1} 张生成失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  const images = successfulResults.flatMap(flattenImageUrls).slice(0, count).map((url, index) => ({
    id: `nano_${Date.now()}_${index}`,
    url,
    provider: "Nano Banana 2"
  }));
  if (!images.length) {
    if (warnings.length) throw new Error(warnings.join("；"));
    console.warn("[nano-banana] no image url parsed", JSON.stringify(successfulResults).slice(0, 1200));
    throw new Error("Nano Banana 2 未返回可解析的图片结果");
  }
  return {
    provider: "Nano Banana 2",
    model: NANO_BANANA_MODEL,
    input: body,
    images,
    ...(warnings.length ? { warnings } : {})
  };
}
