import type { NextRequest } from "next/server";
import { contentStorageRoute } from "@/lib/content-storage/route";
import { listContents } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return contentStorageRoute(request, (ownerId, gateway) => listContents(ownerId, gateway));
}
