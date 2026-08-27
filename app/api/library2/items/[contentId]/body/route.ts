import type { NextRequest } from "next/server";
import { library2Route } from "@/lib/content-library-2/route";
import { clearLibrary2Body } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    return clearLibrary2Body(ownerId, contentId, gateway);
  });
}
