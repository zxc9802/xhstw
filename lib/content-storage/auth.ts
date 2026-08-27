import type { NextRequest } from "next/server";
import { getMainAppSessionCookieName, resolveMainAppSession } from "../main-app-sso";

export async function requireContentStorageOwner(request: NextRequest) {
  const cookie = request.cookies.get(getMainAppSessionCookieName())?.value;
  const session = await resolveMainAppSession(cookie);
  if (!session?.user.id) throw new Error("登录状态无效，请重新登录。");
  return session.user.id;
}
