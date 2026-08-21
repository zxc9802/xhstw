import type { NextRequest } from "next/server";
import { requireContentStorageOwner } from "./auth";
import { getContentStorageGateway } from "./cos";

export async function contentStorageRoute(
  request: NextRequest,
  operation: (ownerId: string, gateway: ReturnType<typeof getContentStorageGateway>) => Promise<unknown>
) {
  try {
    const ownerId = await requireContentStorageOwner(request);
    const result = await operation(ownerId, getContentStorageGateway());
    return result instanceof Response ? result : Response.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "COS 操作失败";
    const status = message.includes("登录") ? 401 : /无效|不支持|最多|超过|尚未上传|不一致/.test(message) ? 400 : 502;
    return Response.json({ ok: false, message }, { status });
  }
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("请求 JSON 无效");
  }
}
