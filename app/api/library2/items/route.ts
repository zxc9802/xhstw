import type { NextRequest } from "next/server";
import { library2Route } from "@/lib/content-library-2/route";
import { listLibrary2Items } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return library2Route(request, (ownerId, gateway) => listLibrary2Items(ownerId, gateway));
}
