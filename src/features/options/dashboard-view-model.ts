import {
  optionProductConfig,
  type OptionDashboardExpiry,
  type OptionProduct,
  type OptionScope,
  type OptionsDashboardResponse,
  type StrikeHeatmapCell,
  type SurfaceLevel,
} from "../../api/options";

export type DashboardStatus = "fresh" | "mixed" | "stale" | "insufficient";
export type GammaRegime = "positive" | "negative" | "neutral" | "insufficient";

export interface GammaRow {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  grossGEX: number;
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
  callIV?: number;
  putIV?: number;
  netDelta?: number;
  netCharm?: number;
  qualityFlags: number;
}

export function canonicalLevelMetric(metric?: string): string | undefined {
  if (!metric) return undefined;
  if (metric === "call_oi_wall" || metric === "call_gex_wall" || metric === "positive_gex_wall") return "call_wall";
  if (metric === "put_oi_wall" || metric === "put_gex_wall" || metric === "negative_gex_wall") return "put_wall";
  if (metric === "zero_gamma") return "gamma_flip";
  return metric;
}

export interface DashboardViewModel {
  source?: string;
  product: OptionProduct;
  scope: OptionScope;
  multiplier: number;
  tickSize: number;
  status: DashboardStatus;
  snapshotUnix: number;
  surfaceMinUnix: number;
  surfaceMaxUnix: number;
  spot?: number;
  regime: GammaRegime;
  netGEX?: number;
  callWall?: number;
  putWall?: number;
  gammaFlip?: number;
  keyGammaStrike?: number;
  expectedMoveUpper?: number;
  expectedMoveLower?: number;
  atmIV?: number;
  putCallOIRatio?: number;
  zeroDTEGrossGEXShare?: number;
  gammaRows: GammaRow[];
  /** 当前到期未截断的全执行价行，供总览图拖拽/缩放 */
  allGammaRows: GammaRow[];
  /** 全量 strike×expiry 网格（未按 MarketState 过滤），供到期热力图使用 */
  heatmapCells: StrikeHeatmapCell[];
  surfaceLevels: SurfaceLevel[];
  expiries: OptionDashboardExpiry[];
  hasQualityWarnings: boolean;
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRegime(value: string | null | undefined): GammaRegime {
  if (!value) return "insufficient";
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized.includes("positive") ||
    normalized.includes("long") ||
    normalized === "pos"
  ) {
    return "positive";
  }
  if (
    normalized.includes("negative") ||
    normalized.includes("short") ||
    normalized === "neg"
  ) {
    return "negative";
  }
  if (normalized.includes("neutral") || normalized.includes("flat")) {
    return "neutral";
  }
  return "insufficient";
}

function cellsForSelectedState(response: OptionsDashboardResponse): StrikeHeatmapCell[] {
  const cells = response.heatmap?.cells ?? [];
  const state = response.market_state;
  if (!state) return cells;
  return cells.filter((cell) => {
    if (
      state.underlying_symbol &&
      cell.underlying_symbol &&
      cell.underlying_symbol.toUpperCase() !== state.underlying_symbol.toUpperCase()
    ) {
      return false;
    }
    return !state.expiration || state.expiration <= 0 || cell.expiration === state.expiration;
  });
}

function wallFromLevels(levels: SurfaceLevel[] | undefined, metric: "call_wall" | "put_wall" | "gamma_flip"): number | undefined {
  const ranked = (levels ?? [])
    .filter((level) => canonicalLevelMetric(level.metric) === metric && (level.rank ?? 1) === 1)
    .map((level) => finiteNumber(level.strike ?? level.level ?? level.value))
    .filter((value): value is number => value !== undefined && value > 0);
  return ranked[0];
}

function deriveGammaFlip(cells: StrikeHeatmapCell[], spot?: number): number | undefined {
  const rows = cells
    .map((cell) => ({ strike: cell.strike, net: cell.net_gex ?? cell.call_gex + cell.put_gex }))
    .filter((cell) => Number.isFinite(cell.strike) && Number.isFinite(cell.net))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return undefined;
  let best: { strike: number; distance: number } | undefined;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const next = rows[i]!;
    if (prev.net === 0) return prev.strike;
    if (prev.net * next.net > 0) continue;
    const strike = prev.strike + (next.strike - prev.strike) * (Math.abs(prev.net) / (Math.abs(prev.net) + Math.abs(next.net) || 1));
    const distance = spot == null ? 0 : Math.abs(strike - spot);
    if (!best || distance < best.distance) best = { strike, distance };
  }
  return best?.strike;
}

const MAX_GAMMA_ROWS = 40;

type GammaRowDraft = GammaRow & {
  callIvSum: number;
  callIvCount: number;
  putIvSum: number;
  putIvCount: number;
};

function stripGammaDraft({
  callIvSum: _callIvSum,
  callIvCount: _callIvCount,
  putIvSum: _putIvSum,
  putIvCount: _putIvCount,
  ...row
}: GammaRowDraft): GammaRow {
  return row;
}

/** 同 strike 多快照行：GEX/OI 求和，IV 取均值（缺失不参与平均）。不截断。 */
export function aggregateGammaRows(cells: StrikeHeatmapCell[]): GammaRow[] {
  const byStrike = new Map<number, GammaRowDraft>();
  for (const cell of cells) {
    const existing = byStrike.get(cell.strike);
    const grossGEX =
      finiteNumber(cell.gross_gex) ?? Math.abs(cell.call_gex) + Math.abs(cell.put_gex);
    const callIV = finiteNumber(cell.call_iv);
    const putIV = finiteNumber(cell.put_iv);
    if (existing) {
      existing.callGEX += cell.call_gex;
      existing.putGEX += cell.put_gex;
      existing.netGEX += cell.call_gex + cell.put_gex;
      existing.grossGEX += grossGEX;
      existing.callOI += cell.call_oi ?? 0;
      existing.putOI += cell.put_oi ?? 0;
      existing.callVol += cell.call_vol ?? 0;
      existing.putVol += cell.put_vol ?? 0;
      existing.netDelta = (existing.netDelta ?? 0) + (cell.net_delta_notional ?? 0);
      existing.netCharm = (existing.netCharm ?? 0) + (cell.net_charm_notional ?? 0);
      existing.qualityFlags |= cell.quality_flags;
      if (callIV !== undefined) {
        existing.callIvSum += callIV;
        existing.callIvCount += 1;
        existing.callIV = existing.callIvSum / existing.callIvCount;
      }
      if (putIV !== undefined) {
        existing.putIvSum += putIV;
        existing.putIvCount += 1;
        existing.putIV = existing.putIvSum / existing.putIvCount;
      }
    } else {
      byStrike.set(cell.strike, {
        strike: cell.strike,
        callGEX: cell.call_gex,
        putGEX: cell.put_gex,
        netGEX: cell.call_gex + cell.put_gex,
        grossGEX,
        callOI: cell.call_oi ?? 0,
        putOI: cell.put_oi ?? 0,
        callVol: cell.call_vol ?? 0,
        putVol: cell.put_vol ?? 0,
        callIV,
        putIV,
        netDelta: cell.net_delta_notional ?? 0,
        netCharm: cell.net_charm_notional ?? 0,
        qualityFlags: cell.quality_flags,
        callIvSum: callIV ?? 0,
        callIvCount: callIV === undefined ? 0 : 1,
        putIvSum: putIV ?? 0,
        putIvCount: putIV === undefined ? 0 : 1,
      });
    }
  }

  return [...byStrike.values()]
    .filter((cell) => Number.isFinite(cell.strike))
    .sort((a, b) => b.strike - a.strike)
    .map(stripGammaDraft);
}

function selectVisibleGammaRows(
  rows: GammaRow[],
  spot: number | undefined,
  anchors: Array<number | undefined>,
): GammaRow[] {
  if (rows.length <= MAX_GAMMA_ROWS || spot === undefined) {
    return rows.slice(0, MAX_GAMMA_ROWS);
  }

  // 窗口锚点并集：现货 / 墙 / 翻转的最近档必含，其余按距现货远近填充到上限
  const keep = new Set<number>();
  const nearestStrike = (value: number) =>
    rows.reduce((best, row) =>
      Math.abs(row.strike - value) < Math.abs(best.strike - value) ? row : best,
    ).strike;
  for (const anchor of [spot, ...anchors]) {
    if (anchor !== undefined) keep.add(nearestStrike(anchor));
  }
  const byDistance = [...rows].sort(
    (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot),
  );
  for (const row of byDistance) {
    if (keep.size >= MAX_GAMMA_ROWS) break;
    keep.add(row.strike);
  }
  return rows.filter((row) => keep.has(row.strike));
}

export function buildDashboardViewModel(
  response: OptionsDashboardResponse,
  requestedScope: OptionScope,
  nowUnix = Math.floor(Date.now() / 1000),
): DashboardViewModel {
  const summary = response.summary;
  const selectedCells = cellsForSelectedState(response);
  const marketAge = response.snapshot_unix
    ? nowUnix - response.snapshot_unix
    : Number.POSITIVE_INFINITY;
  const surfaceAge = response.heatmap?.observed_min_unix
    ? nowUnix - response.heatmap.observed_min_unix
    : Number.POSITIVE_INFINITY;
  const mixedSurface =
    (response.heatmap?.observed_max_unix ?? 0) - (response.heatmap?.observed_min_unix ?? 0) > 300;

  let status: DashboardStatus = "fresh";
  if (!response.market_state && !summary && selectedCells.length === 0) status = "insufficient";
  else if (marketAge > 120 || surfaceAge > 600) status = "stale";
  else if (mixedSurface) status = "mixed";

  const spot = finiteNumber(summary?.underlying_price ?? response.market_state?.underlying_price);
  const levels = response.levels ?? response.heatmap?.levels ?? [];
  const callWall = finiteNumber(summary?.call_wall) ?? wallFromLevels(levels, "call_wall");
  const putWall = finiteNumber(summary?.put_wall) ?? wallFromLevels(levels, "put_wall");
  const gammaFlip =
    finiteNumber(summary?.gamma_flip) ??
    wallFromLevels(levels, "gamma_flip") ??
    deriveGammaFlip(selectedCells, spot);
  const expiries = [...(response.expiries ?? [])].sort(
    (a, b) => a.expiration - b.expiration,
  );
  const qualityValues = [
    response.market_state?.quality_flags ?? 0,
    summary?.quality_flags ?? 0,
    ...selectedCells.map((cell) => cell.quality_flags),
    ...expiries.map((expiry) => expiry.quality_flags ?? 0),
  ];
  const allGammaRows = aggregateGammaRows(selectedCells);

  return {
    source: response.source,
    product: response.product,
    scope: response.scope ?? requestedScope,
    multiplier: optionProductConfig[response.product].multiplier,
    tickSize: optionProductConfig[response.product].tickSize,
    status,
    snapshotUnix: response.snapshot_unix,
    surfaceMinUnix: response.heatmap?.observed_min_unix ?? 0,
    surfaceMaxUnix: response.heatmap?.observed_max_unix ?? 0,
    spot,
    regime: normalizeRegime(summary?.regime ?? response.market_state?.regime),
    netGEX: finiteNumber(summary?.net_gex),
    callWall,
    putWall,
    gammaFlip,
    keyGammaStrike: finiteNumber(summary?.key_gamma_strike),
    expectedMoveUpper: finiteNumber(summary?.expected_move_upper),
    expectedMoveLower: finiteNumber(summary?.expected_move_lower),
    atmIV: finiteNumber(summary?.atm_iv),
    putCallOIRatio: finiteNumber(summary?.visible_put_call_oi_ratio),
    zeroDTEGrossGEXShare: finiteNumber(summary?.zero_dte_gross_gex_share),
    allGammaRows,
    gammaRows: selectVisibleGammaRows(allGammaRows, spot, [callWall, putWall, gammaFlip]),
    heatmapCells: response.heatmap?.cells ?? [],
    surfaceLevels: response.levels ?? response.heatmap.levels ?? [],
    expiries,
    hasQualityWarnings: qualityValues.some((flags) => flags !== 0),
  };
}
