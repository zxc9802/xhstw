import { randomUUID } from "node:crypto";

export type ImageGenerationJobStatus = "queued" | "processing" | "completed" | "failed";

export type ImageGenerationJob = {
  id: string;
  status: ImageGenerationJobStatus;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
};

export const IMAGE_GENERATION_JOB_TTL_MS = 30 * 60 * 1000;

const jobGlobal = globalThis as typeof globalThis & {
  __imageGenerationJobs?: Map<string, ImageGenerationJob>;
};

const jobs = jobGlobal.__imageGenerationJobs ?? new Map<string, ImageGenerationJob>();
jobGlobal.__imageGenerationJobs = jobs;

function cleanupExpiredJobs(now: number) {
  for (const [id, job] of jobs) {
    const terminal = job.status === "completed" || job.status === "failed";
    if (terminal && now - job.updatedAt > IMAGE_GENERATION_JOB_TTL_MS) jobs.delete(id);
  }
}

function snapshot(job: ImageGenerationJob): ImageGenerationJob {
  return { ...job };
}

export function createImageGenerationJob(now = Date.now()): ImageGenerationJob {
  cleanupExpiredJobs(now);
  const job: ImageGenerationJob = {
    id: randomUUID(),
    status: "queued",
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.id, job);
  return snapshot(job);
}

export function getImageGenerationJob(id: string, now = Date.now()): ImageGenerationJob | undefined {
  cleanupExpiredJobs(now);
  const job = jobs.get(id);
  return job ? snapshot(job) : undefined;
}

export async function runImageGenerationJob(id: string, task: () => Promise<unknown>): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  jobs.set(id, { ...job, status: "processing", updatedAt: Date.now() });
  try {
    const result = await task();
    const current = jobs.get(id);
    if (current) jobs.set(id, { ...current, status: "completed", updatedAt: Date.now(), result });
  } catch (error) {
    const current = jobs.get(id);
    if (current) {
      jobs.set(id, {
        ...current,
        status: "failed",
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : "图片生成失败"
      });
    }
  }
}
