import type { OptionScope } from "@/api/options";
import type { DashboardViewModel } from "../options/dashboard-view-model";

function canonicalLevelMetric(metric?: string): string | undefined {
  if (!metric) return undefined;
  if (metric === "call_oi_wall" || metric === "call_gex_wall" || metric === "positive_gex_wall") return "call_wall";
  if (metric === "put_oi_wall" || metric === "put_gex_wall" || metric === "negative_gex_wall") return "put_wall";
  if (metric === "zero_gamma") return "gamma_flip";
  return metric;
}

export type HeatmapExpiryMode = "front" | "all";

export interface HeatmapCellDatum {
  callGex: number;
  putGex: number;
  netGex: number;
  grossGex: number;
  netDelta?: number;
  grossDelta?: number;
  netCharm?: number;
  grossCharm?: number;
  oiImbalance?: number;
  qualityFlags: number;
}

export interface ExpiryLevels { callWall?: number; putWall?: number; flip?: number; }
export interface ScopeKeyLevels { scope: OptionScope; spot?: number; callWall?: number; putWall?: number; gammaFlip?: number; }
export interface ExpirationHeatmapModel {
  /** UTC calendar-day columns, matching the Rust option heatmap. */
  expirations: number[];
  strikes: number[];
  cells: Map<string, HeatmapCellDatum>;
  expiryLevels: Map<number, ExpiryLevels>;
  scopeLevels: ScopeKeyLevels[];
  maxAbs: number;
  truncatedExpirations: number;
  truncatedStrikes: number;
  frontExpirationFallback: boolean;
  spot?: number;
  callWall?: number;
  putWall?: number;
  gammaFlip?: number;
  tickSize: number;
  scope: string;
  snapshotUnix: number;
  hasQualityWarnings: boolean;
}

const MAX_CALENDAR_DAYS = 30;

const dayUnix = (unix: number) => Math.floor(unix / 86400) * 86400;
export function heatmapCellKey(expiration: number, strike: number): string { return `${expiration}:${strike}`; }
export const QUALITY_MISSING_OI = 1 << 2;
/** Missing-OI model zeros are unavailable; BelowMinOI alone remains an explicit zero. */
export function displayHeatmapValue(value: number | undefined, qualityFlags: number): number | undefined {
  return value === 0 && (qualityFlags & QUALITY_MISSING_OI) !== 0 ? undefined : value;
}
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
function mergeOptional(existing: boolean, value: number | undefined, next: number | null | undefined) {
  if (!existing) return finite(next) ? next : undefined;
  return value !== undefined && finite(next) ? value + next : undefined;
}

function densestUnix(cells: Array<{ unix: number }>): number | undefined {
  const counts = new Map<number, number>();
  for (const cell of cells) {
    if (!Number.isFinite(cell.unix)) continue;
    counts.set(cell.unix, (counts.get(cell.unix) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [unix, count] of counts) {
    if (count > bestCount) {
      best = unix;
      bestCount = count;
    }
  }
  return best;
}

/** Official heatmap consumes one minute only; if no cell matches snapshotUnix, take the densest minute instead of summing. */
function snapshotSlice(viewModel: DashboardViewModel) {
  const exact = viewModel.heatmapCells.filter((cell) => cell.unix === viewModel.snapshotUnix);
  if (exact.length) return { cells: exact, unix: viewModel.snapshotUnix };
  const unix = densestUnix(viewModel.heatmapCells) ?? viewModel.snapshotUnix;
  return {
    cells: viewModel.heatmapCells.filter((cell) => cell.unix === unix),
    unix,
  };
}

export function buildExpirationHeatmapModel(
  viewModel: DashboardViewModel,
  scopeLevels: ScopeKeyLevels[] = [],
  expiryMode: HeatmapExpiryMode = "front",
  tradingDay?: string,
): ExpirationHeatmapModel {
  const requestedAnchor = tradingDay ? Date.parse(`${tradingDay}T00:00:00Z`) / 1000 : NaN;
  const anchor = Number.isFinite(requestedAnchor) ? requestedAnchor : dayUnix(viewModel.snapshotUnix || Date.now() / 1000);
  // EOD 热力图只能消费与 MarketState 完全同刻的官方快照；绝不跨分钟求和。
  const snapshot = snapshotSlice(viewModel);
  const snapshotCells = snapshot.cells;
  const listedDays = [...new Set(snapshotCells.map((cell) => dayUnix(cell.expiration)).filter(Number.isFinite))].sort((a, b) => a - b);
  const futureDays = listedDays.filter((day) => day >= anchor);
  const allDays = futureDays.length ? futureDays : listedDays;
  const exactFront = allDays.includes(anchor);
  const expirations = expiryMode === "front" ? allDays.slice(exactFront ? allDays.indexOf(anchor) : 0, exactFront ? allDays.indexOf(anchor) + 1 : 1) : allDays.slice(0, MAX_CALENDAR_DAYS);
  const expirySet = new Set(expirations);
  const strikes = [...new Set(snapshotCells.filter((cell) => expirySet.has(dayUnix(cell.expiration))).map((cell) => cell.strike).filter(Number.isFinite))].sort((a, b) => b - a);
  const strikeSet = new Set(strikes);
  const cells = new Map<string, HeatmapCellDatum>();
  for (const cell of snapshotCells) {
    const expiration = dayUnix(cell.expiration);
    if (!expirySet.has(expiration) || !strikeSet.has(cell.strike)) continue;
    const key = heatmapCellKey(expiration, cell.strike);
    const existing = cells.get(key);
    const old = existing ?? { callGex: 0, putGex: 0, netGex: 0, grossGex: 0, qualityFlags: 0 };
    old.callGex += cell.call_gex;
    old.putGex += cell.put_gex;
    old.netGex += cell.call_gex + cell.put_gex;
    old.grossGex += typeof cell.gross_gex === "number" ? cell.gross_gex : Math.abs(cell.call_gex) + Math.abs(cell.put_gex);
    old.netDelta = mergeOptional(!!existing, old.netDelta, cell.net_delta_notional);
    old.grossDelta = mergeOptional(!!existing, old.grossDelta, cell.gross_delta_notional);
    old.netCharm = mergeOptional(!!existing, old.netCharm, cell.net_charm_notional);
    old.grossCharm = mergeOptional(!!existing, old.grossCharm, cell.gross_charm_notional);
    old.oiImbalance = mergeOptional(!!existing, old.oiImbalance, cell.call_oi != null && cell.put_oi != null ? cell.call_oi - cell.put_oi : undefined);
    old.qualityFlags |= cell.quality_flags;
    cells.set(key, old);
  }
  const expiryLevels = new Map<number, ExpiryLevels>();
  for (const level of viewModel.surfaceLevels ?? []) {
    if (level.unix !== snapshot.unix || typeof level.expiration !== "number" || typeof level.level !== "number" || (level.rank ?? 1) !== 1) continue;
    const expiration = dayUnix(level.expiration);
    if (!expirySet.has(expiration)) continue;
    const entry = expiryLevels.get(expiration) ?? {};
    const metric = canonicalLevelMetric(level.metric);
    const price = level.level ?? level.strike;
    if (price == null || !Number.isFinite(price)) continue;
    if (metric === "call_wall") entry.callWall = price;
    if (metric === "put_wall") entry.putWall = price;
    if (metric === "gamma_flip") entry.flip = price;
    expiryLevels.set(expiration, entry);
  }
  let maxAbs = 1e-9;
  for (const cell of cells.values()) maxAbs = Math.max(maxAbs, Math.abs(cell.netGex), Math.abs(cell.callGex), Math.abs(cell.putGex));
  return {
    expirations, strikes, cells, expiryLevels, scopeLevels, maxAbs,
    truncatedExpirations: Math.max(0, allDays.length - expirations.length),
    truncatedStrikes: 0,
    frontExpirationFallback: expiryMode === "front" && expirations.length > 0 && !exactFront,
    spot: viewModel.spot, callWall: viewModel.callWall, putWall: viewModel.putWall, gammaFlip: viewModel.gammaFlip,
    tickSize: viewModel.tickSize, scope: viewModel.scope, snapshotUnix: snapshot.unix, hasQualityWarnings: viewModel.hasQualityWarnings,
  };
}
