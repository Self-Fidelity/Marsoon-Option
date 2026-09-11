import { NextResponse, type NextRequest } from "next/server";

import { AuthBackendError, applyAuthCookies, clearAuthCookies, refreshAuthSession, type AuthBackendResult, validateAccessToken } from "@/server/auth-bff";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, AUTH_SESSION_COOKIE, accessTokenExpiration, verifyAuthSession } from "@/server/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const now = Math.floor(Date.now() / 1000);
  const signed = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  const session = await verifyAuthSession(signed, now);
  if (session && session.exp > now + 300) return NextResponse.json({ authenticated: true, user: { id: session.sub, email: session.email }, expires_at: session.exp });

  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      const auth = await refreshAuthSession(refreshToken);
      const response = NextResponse.json({ authenticated: true, user: auth.user ?? null });
      await applyAuthCookies(response, auth, session?.email ?? "");
      return response;
    } catch (error) {
      if (!(error instanceof AuthBackendError) || (error.status !== 401 && error.status !== 400)) {
        return NextResponse.json({ authenticated: false }, { status: 503 });
      }
    }
  }

  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken) {
    try {
      const user = await validateAccessToken(accessToken);
      const auth: AuthBackendResult = { access_token: accessToken, expires_at: accessTokenExpiration(accessToken) ?? now + 3600, user };
      const response = NextResponse.json({ authenticated: true, user });
      await applyAuthCookies(response, auth, user.email);
      return response;
    } catch (error) {
      if (!(error instanceof AuthBackendError) || (error.status !== 401 && error.status !== 400)) {
        return NextResponse.json({ authenticated: false }, { status: 503 });
      }
    }
  }

  const response = NextResponse.json({ authenticated: false }, { status: 401 });
  clearAuthCookies(response);
  return response;
}
