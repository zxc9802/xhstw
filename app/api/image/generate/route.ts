import { generateImage } from "@/lib/adapters/openai-image";
import { generateWithNanoBanana } from "@/lib/adapters/nano-banana";
import { createImageGenerationJob, runImageGenerationJob } from "@/lib/adapters/image-generation-job-store";
import { readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  const body = await readJson(request);
  const provider = body && typeof body === "object" && "provider" in body ? String((body as { provider?: unknown }).provider) : "";
  const job = createImageGenerationJob();

  void runImageGenerationJob(job.id, async () => {
    try {
      const result = provider.includes("Nano") || process.env.IMAGE_MODEL_PROVIDER === "nano-banana" ? await generateWithNanoBanana(body) : await generateImage(body);
      const imageCount = result && typeof result === "object" && "images" in result && Array.isArray((result as { images?: unknown }).images) ? (result as { images: unknown[] }).images.length : 0;
      console.log(`[image/generate] job=${job.id} provider=${provider || "default"} images=${imageCount}`);
      return result;
    } catch (error) {
      console.error(`[image/generate] job=${job.id}`, error);
      throw error;
    }
  });

  return Response.json(
    { ok: true, data: { jobId: job.id, status: job.status } },
    { status: 202 }
  );
}
