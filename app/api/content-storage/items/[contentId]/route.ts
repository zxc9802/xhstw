import type { NextRequest } from "next/server";
import type { ContentDraft, UploadIntentObject } from "@/lib/content-storage/contracts";
import { contentStorageRoute, readJson } from "@/lib/content-storage/route";
import { deleteContent, getContent, replaceContent } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const item = await getContent(ownerId, contentId, gateway);
    return item ?? new Response("Not Found", { status: 404 });
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    await deleteContent(ownerId, contentId, gateway);
    return { deleted: true };
  });
}

export async function PUT(
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
    return replaceContent(ownerId, contentId, body.content, body.uploads, gateway);
  });
}
