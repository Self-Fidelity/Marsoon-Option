import "server-only";

import { NextResponse } from "next/server";

import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  AUTH_SESSION_COOKIE,
  accessTokenExpiration,
  signAuthSession,
  type AuthSession,
  type AuthUser,
} from "./auth-session";

export interface AuthBackendResult {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

export class AuthBackendError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

function backendBase() {
  const value = process.env.OPTIONS_API_BASE_URL?.trim();
  if (!value) throw new AuthBackendError("登录服务尚未配置", 503);
  return value;
}

function message(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  for (const key of ["msg", "error_description", "message", "error", "error_code"]) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export async function callAuthBackend(path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(new URL(path, backendBase()), { ...init, cache: "no-store", signal: AbortSignal.timeout(16000) });
  } catch {
    throw new AuthBackendError("登录服务暂时无法连接", 502);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!response.ok) throw new AuthBackendError(message(body, `登录服务返回 HTTP ${response.status}`), response.status);
  return body;
}

const refreshInFlight = new Map<string, Promise<AuthBackendResult>>();

export function refreshAuthSession(refreshToken: string): Promise<AuthBackendResult> {
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const auth = await callAuthBackend("/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) }) as AuthBackendResult;
      if (!auth?.access_token) throw new AuthBackendError("刷新响应缺少访问令牌");
      return auth;
    } finally {
      refreshInFlight.delete(refreshToken);
    }
  })();
  refreshInFlight.set(refreshToken, promise);
  return promise;
}

const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function applyAuthCookies(response: NextResponse, auth: AuthBackendResult, fallbackEmail = "") {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = auth.expires_at ?? (auth.expires_in ? now + auth.expires_in : accessTokenExpiration(auth.access_token)) ?? now + 3600;
  const user: AuthUser = { id: auth.user?.id?.trim() || "authenticated-user", email: auth.user?.email?.trim() || fallbackEmail };
  const session: AuthSession = { sub: user.id, email: user.email, exp: expiresAt };
  const maxAge = Math.max(60, expiresAt - now);
  response.cookies.set(AUTH_SESSION_COOKIE, await signAuthSession(session), { ...cookieBase, maxAge });
  response.cookies.set(AUTH_ACCESS_COOKIE, auth.access_token, { ...cookieBase, maxAge });
  if (auth.refresh_token) response.cookies.set(AUTH_REFRESH_COOKIE, auth.refresh_token, { ...cookieBase, maxAge: 60 * 60 * 24 * 30 });
  return user;
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [AUTH_SESSION_COOKIE, AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE]) response.cookies.set(name, "", { ...cookieBase, maxAge: 0 });
}

export async function validateAccessToken(accessToken: string): Promise<AuthUser> {
  const body = await callAuthBackend("/auth/session", { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } });
  const user = body && typeof body === "object" ? (body as { user?: { id?: unknown; email?: unknown } }).user : undefined;
  if (!user || typeof user.id !== "string" || !user.id) throw new AuthBackendError("登录状态无效", 401);
  return { id: user.id, email: typeof user.email === "string" ? user.email : "" };
}
