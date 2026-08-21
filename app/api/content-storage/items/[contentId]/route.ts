import type { NextRequest } from "next/server";
import { contentStorageRoute } from "@/lib/content-storage/route";
import { deleteContent, getContent } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const item = await getContent(ownerId, contentId, gateway);
    return item ?? new Response("Not Found", { status: 404 });
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    await deleteContent(ownerId, contentId, gateway);
    return { deleted: true };
  });
}
