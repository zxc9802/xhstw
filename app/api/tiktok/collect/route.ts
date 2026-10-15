import { NextResponse } from "next/server";
import { TikTokServiceError } from "@/lib/tiktok/errors";
import { collectTikTokVideos, getTikTokCapabilities } from "@/lib/tiktok/provider";
import { ok } from "@/lib/utils/api";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() { return ok(getTikTokCapabilities()); }

export async function POST(request: Request) {
  try {
    const input = await request.json().catch(() => { throw new TikTokServiceError("请求需要有效 JSON"); });
    return ok(await collectTikTokVideos(input));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof TikTokServiceError ? error.message : "采集失败，请检查服务配置" }, { status: error instanceof TikTokServiceError ? error.status : 502 });
  }
}
