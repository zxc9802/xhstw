import { after, NextRequest, NextResponse } from "next/server";
import { TikTokServiceError } from "@/lib/tiktok/errors";
import { collectTikTokVideos, getTikTokCapabilities, validateCollectionInput } from "@/lib/tiktok/provider";
import { collectionJobStore } from "@/lib/tiktok/collection-jobs";
import { getMainAppSessionCookieName, resolveMainAppSession } from "@/lib/main-app-sso";
import { ok } from "@/lib/utils/api";
import { collectionRequestId, collectionTraceHeader, logCollectionRequest } from "@/lib/tiktok/diagnostics";

export const runtime = "nodejs";
export const maxDuration = 420;

async function owner(request: Request) {
  const session = await resolveMainAppSession(new NextRequest(request.url, { headers: request.headers }).cookies.get(getMainAppSessionCookieName())?.value);
  if (!session) throw new TikTokServiceError("登录已失效，请重新登录后取回采集结果", 401);
  return session.user.id;
}

export async function GET(request: Request) {
  const requestId = collectionRequestId(request.headers);
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (jobId !== null) {
    try {
      const job = collectionJobStore().get(await owner(request), jobId);
      return NextResponse.json(job ? { ok: true, data: job } : { ok: false, error: "未找到采集任务，服务可能已重新部署。此次没有重新发起采集。" }, { status: job ? 200 : 404, headers: { [collectionTraceHeader]: requestId, "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof TikTokServiceError ? error.message : "暂时无法读取采集任务" }, { status: error instanceof TikTokServiceError ? error.status : 503, headers: { [collectionTraceHeader]: requestId, "Cache-Control": "no-store" } });
    }
  }
  logCollectionRequest(requestId, "route.status", { method: "GET", status: 200 });
  const response = ok(getTikTokCapabilities());
  response.headers.set(collectionTraceHeader, requestId);
  return response;
}

export async function POST(request: Request) {
  const requestId = collectionRequestId(request.headers), started = Date.now();
  logCollectionRequest(requestId, "route.enter", { method: "POST", scrapeCreatorsConfigured: Boolean(process.env.SCRAPECREATORS_API_KEY?.trim()), tikHubConfigured: Boolean(process.env.TIKHUB_API_KEY?.trim()) });
  try {
    const userId = await owner(request);
    const body = await request.json().catch(() => { throw new TikTokServiceError("请求需要有效 JSON"); });
    if (!body || typeof body !== "object" || typeof body.jobId !== "string") throw new TikTokServiceError("请刷新页面后使用后台采集任务");
    const { jobId, ...input } = body;
    validateCollectionInput(input);
    const store = collectionJobStore();
    const { job, created } = store.create(userId, jobId, input, requestId);
    if (created) after(async () => {
      try { await store.run(userId, jobId, onProgress => collectTikTokVideos(input, { requestId, onProgress })); }
      catch (error) { logCollectionRequest(requestId, "job.persistence_error", { jobId, errorType: error instanceof Error ? error.name : "unknown" }); }
    });
    logCollectionRequest(requestId, "route.accepted", { jobId, status: 202, elapsedMs: Date.now() - started });
    return NextResponse.json({ ok: true, data: job }, { status: 202, headers: { [collectionTraceHeader]: requestId, "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof TikTokServiceError ? error.status : 502;
    logCollectionRequest(requestId, "route.error", { status, elapsedMs: Date.now() - started, errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: error instanceof TikTokServiceError ? error.message : "采集失败，请检查服务配置" }, { status, headers: { [collectionTraceHeader]: requestId } });
  }
}
