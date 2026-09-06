import type { OptionProduct, OptionScope, OptionsDashboardResponse, OptionsLevelsResponse, OptionsIntradayResponse, IntradayLevelPoint, SurfaceLevel } from "../api/options";

type Row = Record<string, unknown>;
export function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("期权接口响应结构不符");
  return value as Row;
}
export function list(value: unknown): Row[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error("期权接口数组字段缺失");
  return value.map(object);
}
export function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
export function requiredNumber(value: unknown): number { const n = number(value); if (n === null) throw new Error("期权接口数值字段无效"); return n; }

function chicagoParts(unix: number) {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(unix * 1000));
  return Object.fromEntries(values.map((p) => [p.type, p.value]));
}
function dateText(unix: number) { const p = chicagoParts(unix); return `${p.year}-${p.month}-${p.day}`; }
export function cmeSession(now: number): { day: string; from: number; to: number } {
  const p = chicagoParts(now);
  const localDay = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const tradeDay = localDay + (Number(p.hour) >= 17 ? 86400000 : 0);
  const day = new Date(tradeDay).toISOString().slice(0, 10);
  const target = tradeDay - 86400000 + 17 * 3600000;
  let from = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(from));
    const v = Object.fromEntries(parts.map((a) => [a.type, a.value]));
    const local = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute), Number(v.second));
    from += target - local;
  }
  return { day, from: Math.floor(from / 1000), to: Math.floor(now / 60) * 60 + 60 };
}
export function isCurrentZeroDte(expiration: number, now: number) {
  const local = chicagoParts(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(new Date(now * 1000));
  if (weekday === "Sat" || (weekday === "Sun" && Number(local.hour) < 17) || (weekday === "Fri" && Number(local.hour) >= 17)) return false;
  return expiration > now && dateText(expiration) === cmeSession(now).day;
}
export function levelRows(raw: unknown): SurfaceLevel[] {
  return list(raw).flatMap((r) => {
    // Go level is the price. value is exposure/strength, never a fallback price.
    const price = number(r.level);
    if (price === null || typeof r.metric !== "string") return [];
    return [{ unix: requiredNumber(r.unix), expiration: number(r.expiration) ?? undefined, metric: r.metric === "zero_gamma" ? "gamma_flip" : r.metric,
      rank: number(r.rank) ?? 1, strike: price, value: number(r.value) ?? undefined, quality_flags: number(r.quality_flags) ?? 0 }];
  }).filter((r, i, a) => a.findIndex((x) => x.unix === r.unix && x.expiration === r.expiration && x.metric === r.metric && x.rank === r.rank) === i);
}
export function emptyDashboard(product: OptionProduct, scope: OptionScope, reason: string): OptionsDashboardResponse {
  return { source: "databento-go", product, scope, has_data: false, missing_reason: reason, snapshot_unix: 0, market_state: null, summary: null,
    levels: [], expiries: [], heatmap: { observed_min_unix: 0, observed_max_unix: 0, cells: [], levels: [] } };
}
export function adaptDashboard(value: unknown, product: OptionProduct, scope: OptionScope, now: number): OptionsDashboardResponse {
  const r = object(value);
  if (r.product !== product || r.scope !== scope) throw new Error("期权接口品种或周期不匹配");
  const heatmap = object(r.heatmap); const rawCells = list(heatmap.cells);
  if (!r.market_state || !r.summary || r.has_data === false) return emptyDashboard(product, scope, scope === "close" ? "收盘核算数据尚未就绪" : "当前周期尚无已计算数据");
  const state = object(r.market_state); const summary = { ...object(r.summary) };
  if (scope === "0dte" && !isCurrentZeroDte(requiredNumber(state.expiration), now)) return emptyDashboard(product, scope, "当前交易日没有可用的0DTE快照");
  const flags = number(state.quality_flags) ?? 0;
  if (flags & (1 | 8)) { summary.net_gex = null; summary.gross_gex = null; }
  const underlying = typeof state.underlying_symbol === "string" ? state.underlying_symbol : undefined;
  const cells = rawCells.filter((c) => !underlying || c.underlying_symbol === underlying).filter((c) => ((number(c.quality_flags) ?? 0) & (4 | 32 | 256 | 1024)) === 0).map((c) => ({
    unix: requiredNumber(c.unix), expiration: requiredNumber(c.expiration), underlying_symbol: String(c.underlying_symbol), strike: requiredNumber(c.strike),
    call_gex: requiredNumber(c.call_gex), put_gex: requiredNumber(c.put_gex), gross_gex: number(c.gross_gex) ?? undefined,
    call_oi: number(c.call_oi), put_oi: number(c.put_oi), call_vol: number(c.call_vol), put_vol: number(c.put_vol),
    call_iv: number(c.call_iv), put_iv: number(c.put_iv), quality_flags: number(c.quality_flags) ?? 0,
  }));
  return { source: "databento-go", product, scope, has_data: true, underlying_symbol: underlying, snapshot_unix: requiredNumber(r.snapshot_unix),
    data_notice: typeof r.data_notice === "string" ? r.data_notice : undefined,
    market_state: state as unknown as OptionsDashboardResponse["market_state"], summary: summary as OptionsDashboardResponse["summary"],
    levels: levelRows(r.levels), expiries: list(r.expiries).filter((e) => !underlying || e.underlying_symbol === underlying).map((e) => ({ ...e, expiration: requiredNumber(e.expiration), gross_gex: requiredNumber(e.gross_gex), delta: number(e.net_delta_notional) ?? undefined, charm: number(e.net_charm_notional) ?? undefined })),
    heatmap: { observed_min_unix: cells.length ? Math.min(...cells.map((c) => c.unix)) : 0, observed_max_unix: cells.length ? Math.max(...cells.map((c) => c.unix)) : 0, cells, levels: levelRows(heatmap.levels ?? []) } };
}
export function adaptLevels(value: unknown, product: OptionProduct, scope: OptionScope): OptionsLevelsResponse {
  const r = object(value); if (r.product !== product || r.scope !== scope) throw new Error("历史价位响应不匹配");
  const states = list(r.states).map((s) => ({ ...s, unix: requiredNumber(s.unix), expiration: requiredNumber(s.expiration) }));
  const levels = levelRows(r.levels).map((l) => ({ ...l, metric: l.metric! }));
  return { source: "databento-go", product, scope, has_data: states.length > 0 || levels.length > 0, from: requiredNumber(r.from), to: requiredNumber(r.to), timeframe: requiredNumber(r.timeframe), states, levels };
}
export function adaptIntraday(rawLevels: unknown, rawBars: unknown, product: OptionProduct, scope: OptionScope, day: string, underlying: string): OptionsIntradayResponse {
  const r = object(rawLevels); const states = list(r.states).filter((s) => s.underlying_symbol === underlying);
  const prices = levelRows(r.levels); const byTime = new Map<number, IntradayLevelPoint>();
  for (const s of states) { const t = requiredNumber(s.unix); const at = prices.filter((l) => l.unix === t && l.expiration === s.expiration && l.rank === 1);
    const find = (name: string) => at.find((l) => l.metric === name)?.strike ?? null;
    byTime.set(t, { t, spot: number(s.underlying_price), call_wall: number(s.call_wall) ?? find("call_wall"), put_wall: number(s.put_wall) ?? find("put_wall"), gamma_flip: number(s.gamma_flip) ?? find("gamma_flip"), atm_iv: number(s.atm_iv), expected_move: number(s.expected_move) }); }
  const levels = [...byTime.values()].sort((a, b) => a.t - b.t);
  const b = object(rawBars); if (b.underlying_symbol !== underlying) throw new Error("K线与期权标的合约不一致");
  const bars = list(b.bars).map((v) => ({
    unix: requiredNumber(v.unix),
    open: requiredNumber(v.open ?? v.o),
    high: requiredNumber(v.high ?? v.h),
    low: requiredNumber(v.low ?? v.l),
    close: requiredNumber(v.close ?? v.c),
    volume: requiredNumber(v.volume ?? v.v),
  }));
  const latest = levels.at(-1); const current = latest ? { captured_at: latest.t, spot: latest.spot, call_wall: latest.call_wall, put_wall: latest.put_wall, gamma_flip: latest.gamma_flip, atm_iv: latest.atm_iv, expected_move: latest.expected_move } : null;
  return { source: "databento-go", product, scope, day, underlying_symbol: underlying, has_data: bars.length > 0 || levels.length > 0, snapshot_unix: current?.captured_at ?? null, bars, levels, current,
    missing_reason: bars.length ? undefined : "该标的合约暂无K线数据" };
}
