import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/content?tab=image", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login"]
};
