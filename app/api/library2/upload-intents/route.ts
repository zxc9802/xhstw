import type { NextRequest } from "next/server";
import { library2Route, readJson } from "@/lib/content-library-2/route";
import { createLibrary2UploadIntent } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return library2Route(request, async (ownerId, gateway) => {
    const body = await readJson(request) as { images?: unknown };
    return createLibrary2UploadIntent(ownerId, body.images ?? [], gateway);
  });
}
