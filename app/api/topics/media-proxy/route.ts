import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: false,
    code: "LOCAL_EXTENSION_REQUIRED",
    message: "小红书抓取已迁移到用户本机浏览器扩展，服务器不再执行该操作。"
  }, { status: 410 });
}
