import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url") ?? "";

  if (!/^https?:\/\//i.test(rawUrl)) {
    return new NextResponse("Bad url", { status: 400 });
  }

  try {
    const upstream = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.xiaohongshu.com/"
      },
      cache: "no-store"
    });

    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Not found", { status: 404 });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=1800"
      }
    });
  } catch {
    return new NextResponse("Proxy failed", { status: 502 });
  }
}
