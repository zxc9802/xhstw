import type { NextRequest } from "next/server";
import { library2Route } from "@/lib/content-library-2/route";
import { deleteLibrary2Image, getLibrary2Media } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; fileId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId, fileId } = await context.params;
    const object = await getLibrary2Media(ownerId, contentId, fileId, gateway);
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; fileId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId, fileId } = await context.params;
    return deleteLibrary2Image(ownerId, contentId, fileId, gateway);
  });
}
