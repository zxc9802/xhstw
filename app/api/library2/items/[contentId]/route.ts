import type { NextRequest } from "next/server";
import { library2Route } from "@/lib/content-library-2/route";
import { deleteLibrary2Item, getLibrary2Item } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const item = await getLibrary2Item(ownerId, contentId, gateway);
    if (!item) throw new Error("内容不存在");
    return item;
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    await deleteLibrary2Item(ownerId, contentId, gateway);
    return { deleted: true };
  });
}
