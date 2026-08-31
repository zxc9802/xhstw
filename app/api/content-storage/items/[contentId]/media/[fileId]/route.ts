import type { NextRequest } from "next/server";
import { storedMediaResponse } from "@/lib/content-storage/media-response";
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
    return storedMediaResponse(object);
  });
}
