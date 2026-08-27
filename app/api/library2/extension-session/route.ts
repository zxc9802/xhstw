import type { NextRequest } from "next/server";
import { requireContentStorageOwner } from "@/lib/content-storage/auth";
import { createLibrary2ExtensionToken } from "@/lib/content-library-2/extension-token";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ownerId = await requireContentStorageOwner(request);
    return Response.json({ ok: true, data: createLibrary2ExtensionToken(ownerId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "插件授权失败";
    return Response.json({ ok: false, message }, { status: message.includes("登录") ? 401 : 502 });
  }
}
