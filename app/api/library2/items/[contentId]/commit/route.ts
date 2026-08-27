import type { NextRequest } from "next/server";
import type { UploadIntentObject } from "@/lib/content-storage/contracts";
import { library2Route, readJson } from "@/lib/content-library-2/route";
import { commitLibrary2Item } from "@/lib/content-library-2/service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return library2Route(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const body = await readJson(request) as {
      content?: unknown;
      uploads?: Array<UploadIntentObject & { uploadUrl?: string }>;
    };
    if (!body.content || !Array.isArray(body.uploads)) throw new Error("图文内容无效");
    return commitLibrary2Item(ownerId, contentId, body.content, body.uploads, gateway);
  });
}
