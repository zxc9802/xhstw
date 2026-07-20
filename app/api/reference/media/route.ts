import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const mimeMap: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const relativePath = searchParams.get("path") ?? "";
  const root = path.resolve(process.cwd(), "xiaohongshu-downloads");
  const target = path.resolve(process.cwd(), relativePath);

  if (!target.startsWith(root) || !fs.existsSync(target)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = fs.readFileSync(target);
  const contentType = mimeMap[path.extname(target).toLowerCase()] ?? "application/octet-stream";
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600"
    }
  });
}
