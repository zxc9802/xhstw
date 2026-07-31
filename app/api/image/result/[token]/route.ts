import { getImageGenerationResult } from "@/lib/adapters/image-generation-result-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const result = getImageGenerationResult(token);
  if (!result) {
    return Response.json({ ok: false, message: "成品图片不存在或已过期。" }, { status: 404 });
  }

  return new Response(result.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(result.bytes.byteLength),
      "Content-Type": result.contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
