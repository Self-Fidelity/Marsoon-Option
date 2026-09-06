import { dashboard, GoOptionsError, params, route } from "@/server/go-options";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const { product, scope, query } = params(request);
    const raw = Number(query.get("days") ?? NaN);
    const days = Number.isInteger(raw) && raw >= 1 && raw <= 3650 ? raw : undefined;
    const asof = query.has("asof") ? Number(query.get("asof")) : undefined;
    if (asof !== undefined && (!Number.isSafeInteger(asof) || asof <= 0)) {
      throw new GoOptionsError("asof 必须为正整数 Unix 秒时间戳", 400);
    }
    return dashboard(product, scope, days, asof);
  });
}
