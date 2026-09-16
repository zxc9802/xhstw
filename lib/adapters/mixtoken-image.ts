import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
import { MainAppBillingError, reserveMainAppCredits } from "@/lib/main-app-billing";

type MixtokenInput = {
  provider?: string;
  prompt?: string;
  size?: string;
  count?: number;
  sourceImageUrls?: string[];
};

type MixtokenResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string } | string;
  message?: string;
  success?: boolean;
};

const PROVIDER = "gpt-image-2.5";
const TIMEOUT_MS = 6 * 60 * 1000;
const MAX_PARALLEL_REQUESTS = Math.max(1, Math.min(10, Number(process.env.OPENAI_IMAGE_PARALLEL_REQUESTS) || 4));

export function isMixtokenImageProvider(provider: string) {
  return provider === PROVIDER;
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

export async function generateWithMixtoken(input: unknown) {
  const body = input && typeof input === "object" ? input as MixtokenInput : {};
  const apiKey = process.env.MIXTOKEN_API_KEY?.trim() || "";
  if (!apiKey) throw new Error(`${PROVIDER} 配置缺失：MIXTOKEN_API_KEY`);
  const primaryModel = process.env.MIXTOKEN_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst";
  const fallbackModel = process.env.MIXTOKEN_IMAGE_FALLBACK_MODEL?.trim() || "gpt-image-2.5";
  const endpoint = process.env.MIXTOKEN_IMAGE_URL?.trim() || "https://api.mixtoken.ai/v1/images/generations";
  const prompt = body.prompt?.trim() || "";
  const size = imageSizeFromRatio(body.size);
  const count = Math.max(1, Math.min(10, Math.trunc(Number(body.count) || 1)));
  const references = body.sourceImageUrls ?? [];
  async function requestImage(model: string) {
    const billing = await reserveMainAppCredits({
      operation: "image-generate", providerId: "mixtoken", model, media: true
    });
    try {
      // Mixtoken accepts reference URLs in generation JSON, not multipart /images/edits.
      const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      const requestBody = JSON.stringify({
        model, prompt, size, n: 1, output_format: "png",
        ...(references.length ? { image: references } : {})
      });
      const response = await fetch(endpoint, {
        method: "POST", headers, body: requestBody, signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      const data: MixtokenResponse = await response.json().catch(() => ({}));
      logImageProviderResponse({
        provider: model, operation: references.length ? "edit" : "generate",
        endpoint, status: response.status, response: data
      });
      if (!response.ok || data.success === false || data.error) {
        const message = (typeof data.error === "string" ? data.error : data.error?.message)
          || data.message || `HTTP ${response.status}`;
        throw new Error(`${PROVIDER} 生成失败（HTTP ${response.status}）：${message.split(apiKey).join("[redacted]")}`);
      }
      const item = data.data?.find((image) => image.b64_json || image.url);
      const url = item?.b64_json
        ? item.b64_json.startsWith("data:image/") ? item.b64_json : `data:image/png;base64,${item.b64_json}`
        : item?.url;
      if (!url) throw new Error(`${PROVIDER} 生成失败：服务商未返回图片。`);
      await billing.settleMedia();
      return { url, model };
    } catch (error) {
      if (error instanceof MainAppBillingError) throw error;
      await billing.release();
      throw error;
    }
  }

  const images: Array<{ id: string; url: string; provider: string; model: string }> = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(count, MAX_PARALLEL_REQUESTS) }, async () => {
    while (nextIndex < count) {
      const index = nextIndex++;
      let primaryError = "";
      // One initial attempt, three retries, then one fallback request.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const model = attempt < 4 ? primaryModel : fallbackModel;
        try {
          const result = await requestImage(model);
          images[index] = { id: `mixtoken_${Date.now()}_${index}`, ...result, provider: PROVIDER };
          break;
        } catch (error) {
          if (error instanceof MainAppBillingError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (attempt < 4) primaryError = message;
          else throw new Error(`${primaryModel} 重试 3 次后仍失败：${primaryError}；${fallbackModel} 兜底失败：${message}`);
        }
      }
    }
  });
  await Promise.all(workers);
  return { provider: PROVIDER, model: images[0].model, input: body, images };
}
