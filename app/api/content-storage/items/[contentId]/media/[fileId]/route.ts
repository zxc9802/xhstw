import type { NextRequest } from "next/server";
import { contentStorageRoute } from "@/lib/content-storage/route";
import { getContentMedia } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; fileId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId, fileId } = await context.params;
    const object = await getContentMedia(ownerId, contentId, fileId, gateway);
    if (!object) return new Response("Not Found", { status: 404 });
    return new Response(object.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Type": object.contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  });
}
