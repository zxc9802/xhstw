import {
  getImageGenerationJob,
  scheduleImageGenerationJob
} from "@/lib/adapters/image-generation-job-store";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getImageGenerationJob(jobId);

  if (!job) {
    return Response.json({ ok: false, message: "图片生成任务不存在" }, { status: 404 });
  }

  if (job.status === "queued") scheduleImageGenerationJob(job.id);
  return Response.json({ ok: true, job });
}
