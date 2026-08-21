import type { NextRequest } from "next/server";
import { contentStorageRoute, readJson } from "@/lib/content-storage/route";
import { createReplacementUploadIntent } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const body = await readJson(request) as { images?: unknown };
    return createReplacementUploadIntent(ownerId, contentId, body.images ?? [], gateway);
  });
}
