import { getImageReference } from "@/lib/adapters/image-reference-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const reference = getImageReference(token);
  if (!reference) {
    return Response.json({ ok: false, message: "参考图不存在或已过期。" }, { status: 404 });
  }

  return new Response(reference.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": reference.contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
