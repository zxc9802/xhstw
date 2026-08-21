import type { NextRequest } from "next/server";
import { contentStorageRoute, readJson } from "@/lib/content-storage/route";
import { createUploadIntent } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const body = await readJson(request) as { images?: unknown };
    return createUploadIntent(ownerId, body.images ?? [], gateway);
  });
}
