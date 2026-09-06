import { NextResponse } from "next/server";

import { clearAuthCookies } from "@/server/auth-bff";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
