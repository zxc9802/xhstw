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

const YUNWU_CHAT_URL = process.env.YUNWU_CHAT_URL || "https://yunwu.ai/v1/chat/completions";
const NANO_BANANA_MODEL = process.env.NANO_BANANA_MODEL || "gemini-3.1-flash-image";
export const NANO_BANANA_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function asRecord(input: unknown): NanoBananaInput {
  return input && typeof input === "object" ? input as NanoBananaInput : {};
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
      const remoteUrls = text.match(/https?:\/\/[^\s"'<>)]*/g)?.filter((url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || /image|img|file|cdn|oss|cos|yunwu/i.test(url)) ?? [];
      return [...dataUrls, ...remoteUrls];
    }
  }
  if (Array.isArray(value)) return value.flatMap(flattenImageUrls);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedImageUrl = record.image_url && typeof record.image_url === "object" ? (record.image_url as Record<string, unknown>).url : undefined;
    const candidates = [
      record.url,
      record.image_url,
      nestedImageUrl,
      record.image,
      record.imageUrl,
      record.b64_json ? `data:image/jpeg;base64,${record.b64_json}` : undefined,
      record.base64 ? `data:image/jpeg;base64,${record.base64}` : undefined,
      record.data,
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

  const apiKey = process.env.NANO_BANANA_API_KEY || process.env.YUNWU_API_KEY;
  if (!apiKey || process.env.IMAGE_MODEL_PROVIDER === "mock") return mockImages(body);

  const promptParts = [
    body.prompt || "生成一张适合内容生产中台图文页面的图片。",
    `画幅比例：${body.size || "1:1"}。`,
    body.sourceImages?.length ? `参考素材名称：${body.sourceImages.join("、")}` : "",
    body.sourceImageUrls?.length ? "参考图片已经随消息传入。请把它们按顺序理解为图一、图二、图三等。" : "",
    "严格按用户提示词生成，不要自行引用发布文案、标题或其他上下文。如果用户要求背景完全不变、只替换某个产品、图一换成图二产品等，只修改指定对象，其他元素尽量保持一致。"
  ].filter(Boolean).join("\n");

  const requestOne = async (index: number) => fetch(YUNWU_CHAT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: NANO_BANANA_MODEL,
      messages: [
        { role: "system", content: "你是图片生成模型。请直接返回图片结果，保持用户指定比例。" },
        {
          role: "user",
          content: [
            { type: "text", text: `${promptParts}\n这是第 ${index + 1} 张，请单独生成一张完整图片，不要做拼图或多宫格。` },
            ...(body.sourceImageUrls ?? []).map((url) => ({ type: "image_url", image_url: { url } }))
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(NANO_BANANA_REQUEST_TIMEOUT_MS)
  });

  const count = Math.max(1, Math.min(10, Number(body.count) || 1));
  const results = await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
    const billing = await reserveMainAppCredits({
      operation: "image-generate",
      providerId: "yunwu",
      model: NANO_BANANA_MODEL,
      media: true,
    });
    try {
      const response = await requestOne(index);
      const data = await response.json().catch(() => ({}));
      logImageProviderResponse({
        provider: "Nano Banana 2",
        operation: "generate",
        endpoint: YUNWU_CHAT_URL,
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
