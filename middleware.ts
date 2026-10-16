import { NextResponse, type NextRequest } from "next/server";
import { collectionTraceHeader, logCollectionRequest } from "./lib/tiktok/diagnostics";
import {
  getMainAppSessionCookieName,
  getMainAppSessionCookieOptions,
  getMainAppSsoLaunchUrl,
  isMainAppSsoDisabled,
  readMainAppSessionCookie,
  validateMainAppSession
} from "./lib/main-app-sso";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = pathname === "/api/tiktok/collect" ? crypto.randomUUID() : undefined;
  const started = Date.now();
  logCollectionRequest(requestId, "auth.enter", { method: request.method });
  function allow(reason: string) {
    if (!requestId) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.set(collectionTraceHeader, requestId);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set(collectionTraceHeader, requestId);
    logCollectionRequest(requestId, "auth.pass", { reason, elapsedMs: Date.now() - started });
    return response;
  }

  if (
    isMainAppSsoDisabled()
    || pathname === "/api/sso/callback"
    || pathname.startsWith("/api/image/reference/")
    || pathname.startsWith("/api/image/result/")
    || pathname.startsWith("/temp-assets/")
    || pathname.startsWith("/api/library2")
    || pathname.startsWith("/api/content-storage")
  ) {
    return allow("bypass");
  }

  const session = await readMainAppSessionCookie(request.cookies.get(getMainAppSessionCookieName())?.value);
  if (session && await validateMainAppSession(session, status => logCollectionRequest(requestId, "auth.checked", { status, elapsedMs: Date.now() - started }))) return allow("session_valid");

  const response = NextResponse.redirect(getMainAppSsoLaunchUrl());
  if (requestId) response.headers.set(collectionTraceHeader, requestId);
  logCollectionRequest(requestId, "auth.redirect", { status: response.status, reason: session ? "session_rejected" : "session_missing_or_invalid", elapsedMs: Date.now() - started });
  response.cookies.set(getMainAppSessionCookieName(), "", { ...getMainAppSessionCookieOptions(), maxAge: 0 });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
