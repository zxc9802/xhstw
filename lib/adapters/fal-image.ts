import { MainAppBillingError, reserveMainAppCredits } from "@/lib/main-app-billing";

const QUEUE_ORIGIN = "https://queue.fal.run";
const TIMEOUT_MS = 6 * 60 * 1000;

type FalResponse = {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  status?: string;
  error?: string;
  detail?: string | Array<{ msg?: string }>;
  images?: Array<{ url?: string }>;
};

function falImageSize(ratio = "1:1") {
  const sizes: Record<string, string> = {
    "1:1": "square_hd", "3:4": "portrait_4_3", "4:3": "landscape_4_3",
    "9:16": "portrait_16_9", "16:9": "landscape_16_9"
  };
  const custom = ratio.trim().match(/^(\d+)x(\d+)$/);
  return custom ? { width: Number(custom[1]), height: Number(custom[2]) } : sizes[ratio] || "square_hd";
}

export async function generateFalImage(input: { prompt: string; size?: string; sourceImageUrls: string[] }) {
  const apiKey = process.env.FAL_KEY?.trim();
  if (!apiKey) throw new Error("fal.ai 配置缺失：FAL_KEY");
  const model = `openai/gpt-image-2.5/sunburst/${input.sourceImageUrls.length ? "edit" : "text-to-image"}`;
  const billing = await reserveMainAppCredits({ operation: "image-generate", providerId: "fal", model, media: true });
  const deadline = Date.now() + TIMEOUT_MS;
  let requestId = "";

  async function request(url: string, init: RequestInit = {}) {
    const target = new URL(url);
    if (target.origin !== QUEUE_ORIGIN || target.username || target.password) {
      throw new Error("fal.ai 返回了无效的任务查询地址。");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("fal.ai 图片生成等待超时。");
    const response = await fetch(target.toString(), {
      ...init, redirect: "error",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(Math.min(30_000, remaining))
    });
    const data = await response.json().catch(() => ({})) as FalResponse;
    if (!response.ok || data.error) {
      const detail = typeof data.detail === "string" ? data.detail : data.detail?.map((item) => item.msg).filter(Boolean).join("；");
      throw new Error(`fal.ai 生成失败（HTTP ${response.status}）：${data.error || detail || response.statusText || "请求失败"}`);
    }
    return data;
  }

  try {
    const queued = await request(`${QUEUE_ORIGIN}/${model}`, {
      method: "POST",
      body: JSON.stringify({
        prompt: input.prompt, quality: "high", num_images: 1, output_format: "png",
        image_size: falImageSize(input.size),
        ...(input.sourceImageUrls.length ? { image_urls: input.sourceImageUrls } : {})
      })
    });
    requestId = queued.request_id || "";
    if (!requestId || !queued.status_url || !queued.response_url) throw new Error("fal.ai 未返回有效的生成任务。");
    while (true) {
      const status = await request(queued.status_url);
      if (status.status === "COMPLETED") break;
      if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
        throw new Error(`fal.ai 返回了未知任务状态：${status.status || "空"}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const result = await request(queued.response_url);
    const url = result.images?.find((image) => typeof image.url === "string" && image.url.startsWith("https://"))?.url;
    if (!url) throw new Error("fal.ai 生成失败：服务商未返回图片。");
    await billing.settleMedia();
    return { url, model, requestId };
  } catch (error) {
    if (error instanceof MainAppBillingError) throw error;
    await billing.release();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message.split(apiKey).join("[redacted]")}${requestId ? `（fal 任务 ${requestId}）` : ""}`);
  }
}
