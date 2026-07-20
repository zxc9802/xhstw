import { NextResponse } from "next/server";
import { openXiaohongshuInSharedBrowser } from "@/lib/adapters/opencli-xiaohongshu";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : "";

  if (!url) {
    return NextResponse.json({ ok: false, message: "缺少作品链接。" }, { status: 400 });
  }

  try {
    const result = await openXiaohongshuInSharedBrowser(url);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : "OpenCLI 浏览器打开失败。"
    }, { status: 500 });
  }
}
