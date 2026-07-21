import { getImageGenerationJob } from "@/lib/adapters/image-generation-job-store";
import { ok } from "@/lib/utils/api";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = getImageGenerationJob(jobId);
  if (!job) {
    return Response.json(
      { ok: false, message: "图片生成任务不存在或已失效，可能是服务已重启，请重新生成。" },
      { status: 404 }
    );
  }
  return ok(job);
}
