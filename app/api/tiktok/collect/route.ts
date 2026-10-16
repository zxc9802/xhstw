import { NextResponse } from "next/server";
import { TikTokServiceError } from "@/lib/tiktok/errors";
import { collectTikTokVideos, getTikTokCapabilities } from "@/lib/tiktok/provider";
import { ok } from "@/lib/utils/api";
import { collectionRequestId, collectionTraceHeader, logCollectionRequest } from "@/lib/tiktok/diagnostics";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const requestId = collectionRequestId(request.headers);
  logCollectionRequest(requestId, "route.status", { method: "GET", status: 200 });
  const response = ok(getTikTokCapabilities());
  response.headers.set(collectionTraceHeader, requestId);
  return response;
}

export async function POST(request: Request) {
  const requestId = collectionRequestId(request.headers), started = Date.now();
  logCollectionRequest(requestId, "route.enter", { method: "POST", scrapeCreatorsConfigured: Boolean(process.env.SCRAPECREATORS_API_KEY?.trim()), tikHubConfigured: Boolean(process.env.TIKHUB_API_KEY?.trim()) });
  try {
    const input = await request.json().catch(() => { throw new TikTokServiceError("请求需要有效 JSON"); });
    const result = await collectTikTokVideos(input, { requestId });
    const response = ok(result);
    response.headers.set(collectionTraceHeader, requestId);
    logCollectionRequest(requestId, "route.complete", { status: response.status, elapsedMs: Date.now() - started, scanned: result.scanned, retained: result.videos.length, warnings: result.warnings.length });
    return response;
  } catch (error) {
    const status = error instanceof TikTokServiceError ? error.status : 502;
    logCollectionRequest(requestId, "route.error", { status, elapsedMs: Date.now() - started, errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: error instanceof TikTokServiceError ? error.message : "采集失败，请检查服务配置" }, { status, headers: { [collectionTraceHeader]: requestId } });
  }
}
