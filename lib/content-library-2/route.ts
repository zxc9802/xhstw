import type { NextRequest } from "next/server";
import { getContentStorageGateway } from "@/lib/content-storage/cos";
import { requireLibrary2Owner } from "./auth";

export async function library2Route(
  request: NextRequest,
  operation: (ownerId: string, gateway: ReturnType<typeof getContentStorageGateway>) => Promise<unknown>
) {
  try {
    const ownerId = await requireLibrary2Owner(request);
    const result = await operation(ownerId, getContentStorageGateway());
    return result instanceof Response ? result : Response.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "爆款选题库2操作失败";
    const status = /登录|授权/.test(message)
      ? 401
      : /无效|不支持|最多|超过|尚未上传|不一致|不存在|不能同时为空/.test(message)
        ? 400
        : 502;
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
