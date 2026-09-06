import type { IvTermResponse, OptionProduct, OptionScope, OptionsDashboardResponse } from "@/api/options";

export function chicagoDate(unix: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(unix * 1000);
  const field = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

/** Compress the existing backend ATM IV summaries; never recompute IV or blend futures months. */
export function buildIvTerm(response: OptionsDashboardResponse, product: OptionProduct, scope: OptionScope, requestedDate?: string): IvTermResponse {
  const snapshot = response.snapshot_unix;
  const base: IvTermResponse = { product, scope, requested_date: requestedDate, snapshot_unix: snapshot || 0, has_data: false, points: [] };
  if (response.has_data === false || !Number.isFinite(snapshot) || snapshot <= 0) return { ...base, missing_reason: response.missing_reason || "该范围暂无可用 ATM IV 快照" };
  if (requestedDate && chicagoDate(snapshot) !== requestedDate) return { ...base, missing_reason: `${requestedDate} 无当日快照，未用其他日期替代` };
  const points = response.expiries.flatMap((point) => {
    if (!point.underlying_symbol || !Number.isFinite(point.expiration) || point.expiration <= snapshot) return [];
    const min = point.observed_min_unix ?? snapshot, max = point.observed_max_unix ?? snapshot;
    const validDate = !requestedDate || (chicagoDate(min) === requestedDate && chicagoDate(max) === requestedDate);
    return [{ expiration: point.expiration, underlying_symbol: point.underlying_symbol,
      atm_iv: validDate && typeof point.atm_iv === "number" && Number.isFinite(point.atm_iv) && point.atm_iv > 0 ? point.atm_iv : null,
      observed_min_unix: min, observed_max_unix: max }];
  }).sort((a, b) => a.expiration - b.expiration || a.underlying_symbol.localeCompare(b.underlying_symbol));
  return { ...base, points, has_data: points.some((p) => p.atm_iv !== null),
    missing_reason: points.some((p) => p.atm_iv !== null) ? undefined : "该快照没有有效 ATM IV；缺失或零值未绘制",
    data_notice: "ATM IV来自后端最近有效执行价的Call/Put IV均值；不同期货合约分组，不跨合约连线。历史为所选日16:00 CT前可用快照，并非官方结算IV。" };
}
