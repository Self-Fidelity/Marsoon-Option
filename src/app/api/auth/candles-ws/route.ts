import { NextResponse, type NextRequest } from "next/server";

import { AUTH_ACCESS_COOKIE, AUTH_SESSION_COOKIE, verifyAuthSession } from "@/server/auth-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await verifyAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
    const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
    if (!session || !token) return NextResponse.json({ error: "登录状态已过期" }, { status: 401 });

    const base = process.env.OPTIONS_API_BASE_URL?.trim();
    if (!base) return NextResponse.json({ error: "行情连接尚未配置" }, { status: 503 });
    const url = new URL("/ws", base);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    else return NextResponse.json({ error: "行情连接配置无效" }, { status: 503 });
    url.search = "";
    url.searchParams.set("token", token);
    return NextResponse.json({ url: url.toString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "行情连接暂时不可用" }, { status: 503 });
  }
}
