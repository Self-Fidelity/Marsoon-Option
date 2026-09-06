import type { OptionProduct, OptionScope, OptionsDashboardResponse, MarketState, SurfaceLevel, StrikeHeatmapCell } from "../api/options";

type LiveState = MarketState & Record<string, unknown>;
type LiveLevel = SurfaceLevel & { scope?: string };
type LiveCell = StrikeHeatmapCell & { underlying_price?: number };
export interface LevelPage { states: LiveState[]; levels: LiveLevel[]; }
export interface SurfacePage { cells: LiveCell[]; levels: LiveLevel[]; }

export function latestState(states: LiveState[]) {
  return [...states].sort((a, b) => b.unix - a.unix || String(a.underlying_symbol).localeCompare(String(b.underlying_symbol)))[0];
}

export function unsupportedScope(scope: OptionScope): string | undefined {
  if (scope === "close") return "正式接口尚未提供收盘 EOD 数据";
  if (scope === "d30" || scope === "d90") return `正式接口尚未提供 ${scope === "d30" ? "30DTE" : "90D"} 聚合口径；不会用最近到期或全期限数据替代`;
}

export function emptyDashboard(product: OptionProduct, scope: OptionScope, reason: string): OptionsDashboardResponse {
  return { product, scope, source: "options-http", has_data: false, missing_reason: reason, snapshot_unix: 0, market_state: null, summary: null, levels: [], expiries: [], heatmap: { observed_min_unix: 0, observed_max_unix: 0, cells: [], levels: [] } };
}

// Compose only public HTTP results. State totals remain server-provided;
// expiry totals below describe only the returned heatmap price window.
export function composeDashboard(product: OptionProduct, scope: OptionScope, page: LevelPage, surface: SurfacePage): OptionsDashboardResponse {
  const reason = unsupportedScope(scope);
  if (reason) return emptyDashboard(product, scope, reason);
  const state = latestState(page.states);
  if (!state) return emptyDashboard(product, scope, "当前品种/周期没有市场状态数据");
  const latest = new Map<string, LiveCell>();
  for (const cell of surface.cells) {
    if (cell.underlying_symbol !== state.underlying_symbol || (scope === "0dte" && cell.expiration !== state.expiration)) continue;
    const key = `${cell.underlying_symbol}|${cell.expiration}|${cell.strike}`;
    if (!latest.has(key) || latest.get(key)!.unix < cell.unix) latest.set(key, cell);
  }
  const cells = [...latest.values()].sort((a, b) => a.expiration - b.expiration || a.strike - b.strike);
  const levels = page.levels.filter((row) => row.unix === state.unix && row.underlying_symbol === state.underlying_symbol && (row.expiration ?? 0) === state.expiration);
  const byExpiry = new Map<number, { expiration: number; call_oi: number; put_oi: number; total_oi: number; call_gex: number; put_gex: number; net_gex: number; gross_gex: number; quality_flags: number }>();
  for (const cell of cells) {
    const row = byExpiry.get(cell.expiration) ?? { expiration: cell.expiration, call_oi: 0, put_oi: 0, total_oi: 0, call_gex: 0, put_gex: 0, net_gex: 0, gross_gex: 0, quality_flags: 0 };
    row.call_oi += cell.call_oi ?? 0;
    row.put_oi += cell.put_oi ?? 0;
    row.total_oi = row.call_oi + row.put_oi;
    row.call_gex += cell.call_gex;
    row.put_gex += cell.put_gex;
    row.net_gex += cell.call_gex + cell.put_gex;
    row.gross_gex += cell.gross_gex ?? Math.abs(cell.call_gex) + Math.abs(cell.put_gex);
    row.quality_flags |= cell.quality_flags;
    byExpiry.set(cell.expiration, row);
  }
  const times = cells.map((c) => c.unix);
  return {
    product, scope, source: "options-http", has_data: true, snapshot_unix: state.unix,
    underlying_symbol: state.underlying_symbol,
    data_notice: "真实 HTTP 数据 · 热力图/到期汇总仅覆盖接口返回的价格窗口与到期日；总览 GEX 使用服务端全范围状态。",
    market_state: state, summary: { ...state }, levels,
    expiries: [...byExpiry.values()],
    heatmap: { cells, levels, observed_min_unix: times.length ? Math.min(...times) : 0, observed_max_unix: times.length ? Math.max(...times) : 0 },
  };
}
