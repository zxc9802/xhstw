import type { NextRequest } from "next/server";
import { library2Route } from "@/lib/content-library-2/route";
import { deleteLibrary2Image, getLibrary2Media } from "@/lib/content-library-2/service";
import { storedMediaResponse } from "@/lib/content-storage/media-response";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; fileId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId, fileId } = await context.params;
    const object = await getLibrary2Media(ownerId, contentId, fileId, gateway);
    if (!object) return new Response("Not Found", { status: 404 });
    return storedMediaResponse(object);
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; fileId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId, fileId } = await context.params;
    return deleteLibrary2Image(ownerId, contentId, fileId, gateway);
  });
}
