import { NextResponse, type NextRequest } from "next/server";
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

  if (
    isMainAppSsoDisabled()
    || pathname === "/api/sso/callback"
    || pathname.startsWith("/api/image/reference/")
    || pathname.startsWith("/temp-assets/")
    || pathname.startsWith("/api/library2")
  ) {
    return NextResponse.next();
  }

  const session = await readMainAppSessionCookie(request.cookies.get(getMainAppSessionCookieName())?.value);
  if (session && await validateMainAppSession(session)) return NextResponse.next();

  const response = NextResponse.redirect(getMainAppSsoLaunchUrl());
  response.cookies.set(getMainAppSessionCookieName(), "", { ...getMainAppSessionCookieOptions(), maxAge: 0 });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
