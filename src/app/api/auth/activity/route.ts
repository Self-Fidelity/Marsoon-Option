import { NextResponse, type NextRequest } from "next/server";

import packageMetadata from "../../../../../package.json";
import { AuthBackendError, callAuthBackend } from "@/server/auth-bff";
import { AUTH_ACCESS_COOKIE, AUTH_SESSION_COOKIE, verifyAuthSession } from "@/server/auth-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const session = await verifyAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
    const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
    if (!session || !accessToken) return NextResponse.json({ error: "登录状态已过期" }, { status: 401 });

    const text = await request.text();
    if (!text || text.length > 1024) return NextResponse.json({ error: "请求无效" }, { status: 400 });
    let body: { event_id?: unknown };
    try { body = JSON.parse(text) as { event_id?: unknown }; }
    catch { return NextResponse.json({ error: "请求无效" }, { status: 400 }); }
    const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
    if (!UUID.test(eventId)) return NextResponse.json({ error: "请求无效" }, { status: 400 });

    const result = await callAuthBackend("/client/activity", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        p_event_id: eventId,
        p_platform: "web",
        p_client_version: packageMetadata.version,
        p_device_id_hash: null,
        p_metadata: { app: "options" },
      }),
    });
    return NextResponse.json(result ?? { recorded: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AuthBackendError && error.status === 401 ? 401 : 502;
    return NextResponse.json({ error: status === 401 ? "登录状态已过期" : "活跃状态记录失败" }, { status });
  }
}
