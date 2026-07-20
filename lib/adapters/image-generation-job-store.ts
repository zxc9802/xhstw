import { generateImage } from "@/lib/adapters/openai-image";

export type ImageGenerationJobStatus = "queued" | "processing" | "completed" | "failed";

export type ImageGenerationJob = {
  id: string;
  status: ImageGenerationJobStatus;
  input: unknown;
  result?: unknown;
  error?: string;
};

const jobs = new Map<string, ImageGenerationJob>();
const runningJobs = new Map<string, Promise<void>>();

export function shouldQueueImageGeneration(input: unknown) {
  if (!input || typeof input !== "object") return false;
  const body = input as { provider?: unknown; sourceImageUrls?: unknown };
  const provider = typeof body.provider === "string" ? body.provider : "";
  return (provider === "Image 2.0" || provider.includes("Nano"))
    && Array.isArray(body.sourceImageUrls)
    && body.sourceImageUrls.length > 0;
}

function snapshot(job: ImageGenerationJob) {
  return {
    id: job.id,
    status: job.status,
    result: job.result,
    error: job.error
  };
}

export function createImageGenerationJob(input: unknown) {
  const job: ImageGenerationJob = {
    id: crypto.randomUUID(),
    status: "queued",
    input
  };
  jobs.set(job.id, job);
  return snapshot(job);
}

export function getImageGenerationJob(jobId: string) {
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}

export function scheduleImageGenerationJob(jobId: string) {
  if (runningJobs.has(jobId)) return;

  const jobPromise = runImageGenerationJob(jobId)
    .catch((error) => {
      console.error("[image-generation-job] unhandled job failure", error);
    })
    .finally(() => {
      runningJobs.delete(jobId);
    });

  runningJobs.set(jobId, jobPromise);
}

export async function runImageGenerationJob(
  jobId: string,
  generate: (input: unknown) => Promise<unknown> = generateImage
) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "queued") return;

  job.status = "processing";

  try {
    job.result = await generate(job.input);
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "图片生成失败";
  }
}
