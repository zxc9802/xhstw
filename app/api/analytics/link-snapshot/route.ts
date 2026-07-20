import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok({ mode: "mock", endpoint: "link-snapshot", note: "仅尝试公开数据解析，不登录平台后台。", received: await readJson(request) });
}
