import { NextResponse } from "next/server";
import { collectXiaohongshuHotTopics } from "@/lib/adapters/opencli-xiaohongshu";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({
      ok: false,
      mode: "empty",
      message: "请先选择或填写关键词后再抓取。",
      topics: []
    }, { status: 400 });
  }
  const result = await collectXiaohongshuHotTopics({
    query,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    mediaType: body.mediaType === "图文" || body.mediaType === "视频" || body.mediaType === "全部" ? body.mediaType : undefined,
    dateRange: body.dateRange === "一天内" || body.dateRange === "一周内" || body.dateRange === "半年内" || body.dateRange === "全部" ? body.dateRange : undefined,
    sortBy: body.sortBy === "浏览量" || body.sortBy === "点赞量" || body.sortBy === "评论量" || body.sortBy === "收藏量" ? body.sortBy : undefined,
    noDuplicate: body.noDuplicate !== false,
    existingUrls: Array.isArray(body.existingUrls) ? body.existingUrls.filter((url: unknown) => typeof url === "string") : undefined
  });

  return NextResponse.json(result);
}
