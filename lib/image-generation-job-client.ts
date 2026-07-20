export type ImageGenerationJobSnapshot = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: unknown;
  error?: string;
};

function waitForNextImageJobPoll(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export async function pollImageGenerationJob(
  jobId: string,
  getJob: (jobId: string) => Promise<ImageGenerationJobSnapshot>,
  wait = waitForNextImageJobPoll
) {
  while (true) {
    const job = await getJob(jobId);
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || "图片生成失败");
    await wait(3000);
  }
}
