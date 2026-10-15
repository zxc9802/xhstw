import { NextResponse } from "next/server";
import { MainAppBillingError } from "@/lib/main-app-billing";
import { TikTokServiceError } from "@/lib/tiktok/errors";
import { generateTikTokProduction } from "@/lib/tiktok/production";
import { ok } from "@/lib/utils/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = await request.json().catch(() => { throw new TikTokServiceError("请求需要有效 JSON"); });
    return ok(await generateTikTokProduction(input));
  } catch (error) {
    const known = error instanceof TikTokServiceError || error instanceof MainAppBillingError;
    return NextResponse.json({ ok: false, error: known ? error.message : "模型生成失败，请检查服务配置或稍后重试；没有生成模拟结果" }, { status: known ? error.status : 502 });
  }
}
