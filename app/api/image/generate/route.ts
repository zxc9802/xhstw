import { generateImage } from "@/lib/adapters/openai-image";
import { generateWithNanoBanana } from "@/lib/adapters/nano-banana";
import { createImageGenerationJob, runImageGenerationJob } from "@/lib/adapters/image-generation-job-store";
import {
  ImageReferenceInputError,
  deleteImageReferences,
  publishImageReferences
} from "@/lib/adapters/image-reference-store";
import { readJson } from "@/lib/utils/api";

function publicRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  if (!forwardedHost || !/^(http|https)$/.test(forwardedProto || "")) return requestUrl.origin;
  try {
    return new URL(`${forwardedProto}://${forwardedHost}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

function usesImage2References(provider: string) {
  return !provider.includes("Nano")
    && !provider.includes("仅生成提示词")
    && process.env.IMAGE_MODEL_PROVIDER !== "nano-banana"
    && process.env.IMAGE_MODEL_PROVIDER !== "mock";
}

function imageSourceUrls(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const value = (body as { sourceImageUrls?: unknown }).sourceImageUrls;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ImageReferenceInputError("参考图列表格式无效。", 400);
  }
  return value as string[];
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const provider = body && typeof body === "object" && "provider" in body ? String((body as { provider?: unknown }).provider) : "";
  let jobBody = body;
  let referenceTokens: string[] = [];

  try {
    if (usesImage2References(provider)) {
      const sourceImageUrls = imageSourceUrls(body);
      if (sourceImageUrls.length) {
        const published = publishImageReferences(sourceImageUrls, publicRequestOrigin(request));
        referenceTokens = published.tokens;
        jobBody = {
          ...(body as Record<string, unknown>),
          sourceImageUrls: published.urls
        };
      }
    }
  } catch (error) {
    if (error instanceof ImageReferenceInputError) {
      return Response.json(
        { ok: false, message: error.message },
        { status: error.status }
      );
    }
    throw error;
  }

  const job = createImageGenerationJob();

  void runImageGenerationJob(job.id, async () => {
    try {
      const result = provider.includes("Nano") || process.env.IMAGE_MODEL_PROVIDER === "nano-banana" ? await generateWithNanoBanana(jobBody) : await generateImage(jobBody);
      const imageCount = result && typeof result === "object" && "images" in result && Array.isArray((result as { images?: unknown }).images) ? (result as { images: unknown[] }).images.length : 0;
      console.log(`[image/generate] job=${job.id} provider=${provider || "default"} images=${imageCount}`);
      return result;
    } catch (error) {
      console.error(`[image/generate] job=${job.id}`, error);
      throw error;
    } finally {
      deleteImageReferences(referenceTokens);
    }
  });

  return Response.json(
    { ok: true, data: { jobId: job.id, status: job.status } },
    { status: 202 }
  );
}
