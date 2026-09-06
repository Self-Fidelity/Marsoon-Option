import { NextResponse, type NextRequest } from "next/server";

import { AUTH_SESSION_COOKIE, verifyAuthSession } from "@/server/auth-session";

export async function proxy(request: NextRequest) {
  let session = null;
  try {
    session = await verifyAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  } catch {
    session = null;
  }
  if (session) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname === "/" ? "/board" : `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/",
    "/board/:path*",
    "/teaching/:path*",
    "/gamma/:path*",
    "/flow/:path*",
    "/volatility/:path*",
    "/zero-dte/:path*",
    "/panel-shot/:path*",
    "/api/options/:path*",
  ],
};
