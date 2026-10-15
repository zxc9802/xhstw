import { NextResponse } from "next/server";
import { currentBillingUserId, MainAppBillingError, runWithMainAppBillingUser } from "@/lib/main-app-billing";
import { isMainAppSsoDisabled } from "@/lib/main-app-sso";
import { TikTokServiceError } from "@/lib/tiktok/errors";
import { analyzeTikTokVideo } from "@/lib/tiktok/media";
import { normalizeVideo, record } from "@/lib/tiktok/videos";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const input = await request.json().catch(() => { throw new TikTokServiceError("请求需要有效 JSON"); });
    try { normalizeVideo(record(input).video); } catch { throw new TikTokServiceError("需要有效的完整 TikTok 视频记录"); }
    const userId = isMainAppSsoDisabled() ? "local" : await currentBillingUserId();
    const abort = new AbortController(), encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
        try {
          const data = await runWithMainAppBillingUser(userId, () => analyzeTikTokVideo(input, {
            signal: AbortSignal.any([request.signal, abort.signal]), onProgress: message => send({ type: "phase", message })
          }));
          send({ type: "done", data });
        } catch (error) {
          const known = error instanceof TikTokServiceError || error instanceof MainAppBillingError;
          send({ type: "error", message: known ? error.message : "原视频读取、转录或音画分析失败，没有生成模拟结果" });
        } finally { if (!cancelled) controller.close(); }
      },
      cancel() { cancelled = true; abort.abort(); }
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) {
    const known = error instanceof TikTokServiceError || error instanceof MainAppBillingError;
    return NextResponse.json({ ok: false, error: known ? error.message : "原视频分析请求无效" }, { status: known ? error.status : 400 });
  }
}
