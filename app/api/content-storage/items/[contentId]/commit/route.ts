import type { NextRequest } from "next/server";
import type { ContentDraft, UploadIntentObject } from "@/lib/content-storage/contracts";
import { contentStorageRoute, readJson } from "@/lib/content-storage/route";
import { commitContent } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const body = await readJson(request) as {
      content?: ContentDraft;
      uploads?: Array<UploadIntentObject & { uploadUrl?: string }>;
    };
    if (!body.content || !Array.isArray(body.uploads)) throw new Error("成品内容无效");
    return commitContent(ownerId, contentId, body.content, body.uploads, gateway);
  });
}
