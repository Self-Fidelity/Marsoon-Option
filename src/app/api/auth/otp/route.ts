import { NextResponse, type NextRequest } from "next/server";

import { AuthBackendError, callAuthBackend } from "@/server/auth-bff";
import { sanitizePublicMessage } from "@/lib/data-messages";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email.includes("@")) return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
    await callAuthBackend("/auth/otp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email }) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizePublicMessage(error instanceof Error ? error.message : undefined, "验证码发送失败") }, { status: error instanceof AuthBackendError ? error.status : 400 });
  }
}
