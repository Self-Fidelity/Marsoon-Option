import { dashboard, GoOptionsError, params, route } from "@/server/go-options";
import { sessionStart } from "@/server/intraday-candles";
import { buildIvTerm, chicagoDate } from "@/server/iv-term-model";
import type { OptionsDashboardResponse } from "@/api/options";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return route(async (signal) => {
    const { product, scope, query } = params(request);
    const date = query.get("date") ?? undefined;
    let asof: number | undefined;
    if (date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
        || date >= chicagoDate(Date.now() / 1000)) throw new GoOptionsError("请选择今天之前的有效历史日期（芝加哥时间）", 400);
      const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      asof = sessionStart(next) - 3600; // 16:00 CT on requested date; DST handled by sessionStart.
    }
    // The same raw dashboard URL is cached/shared with the existing structure panels.
    const data = await dashboard(product, scope, undefined, asof, signal) as OptionsDashboardResponse;
    return buildIvTerm(data, product, scope, date);
  }, request.signal);
}
