import type { NextRequest } from "next/server";
import { library2Route, readJson } from "@/lib/content-library-2/route";
import { createLibrary2LiveUploadIntent } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    return createLibrary2LiveUploadIntent(ownerId, contentId, await readJson(request), gateway);
  });
}
