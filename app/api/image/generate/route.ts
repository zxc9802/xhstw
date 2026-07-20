import { generateImage } from "@/lib/adapters/openai-image";
import { generateWithNanoBanana } from "@/lib/adapters/nano-banana";
import {
  createImageGenerationJob,
  scheduleImageGenerationJob,
  shouldQueueImageGeneration
} from "@/lib/adapters/image-generation-job-store";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  const body = await readJson(request);
  const provider = body && typeof body === "object" && "provider" in body ? String((body as { provider?: unknown }).provider) : "";
  try {
    if (shouldQueueImageGeneration(body)) {
      const job = createImageGenerationJob(body);
      scheduleImageGenerationJob(job.id);
      return Response.json({ ok: true, jobId: job.id, job }, { status: 202 });
    }

    const result = provider.includes("Nano") || process.env.IMAGE_MODEL_PROVIDER === "nano-banana" ? await generateWithNanoBanana(body) : await generateImage(body);
    const imageCount = result && typeof result === "object" && "images" in result && Array.isArray((result as { images?: unknown }).images) ? (result as { images: unknown[] }).images.length : 0;
    console.log(`[image/generate] provider=${provider || "default"} images=${imageCount}`);
    return ok(result);
  } catch (error) {
    console.error("[image/generate]", error);
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "图片生成失败" }, { status: 500 });
  }
}
