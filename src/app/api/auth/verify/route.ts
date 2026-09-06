import { NextResponse, type NextRequest } from "next/server";

import { AuthBackendError, applyAuthCookies, callAuthBackend, type AuthBackendResult } from "@/server/auth-bff";
import { sanitizePublicMessage } from "@/lib/data-messages";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: unknown; code?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!email.includes("@") || !code) return NextResponse.json({ error: "请输入邮箱和验证码" }, { status: 400 });
    const auth = await callAuthBackend("/auth/verify", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, code }) }) as AuthBackendResult;
    if (!auth?.access_token) throw new AuthBackendError("登录响应缺少访问令牌");
    const response = NextResponse.json({ authenticated: true, user: auth.user ?? { email } });
    await applyAuthCookies(response, auth, email);
    return response;
  } catch (error) {
    return NextResponse.json({ error: sanitizePublicMessage(error instanceof Error ? error.message : undefined, "登录失败") }, { status: error instanceof AuthBackendError ? error.status : 400 });
  }
}
