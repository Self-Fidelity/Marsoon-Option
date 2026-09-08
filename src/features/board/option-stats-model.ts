import type { IntradayBar, OptionStatsMetric, OptionStatsPoint, OptionStatsResponse } from "@/api/options";

export const OPTION_STATS_METRICS: ReadonlyArray<{ key: OptionStatsMetric; label: string }> = [
  { key: "netGex", label: "净 GEX" },
];
export const DEFAULT_OPTION_STATS_METRICS: OptionStatsMetric[] = OPTION_STATS_METRICS.map((metric) => metric.key);
export const QUALITY_MISSING_OI = 1 << 2;

export interface OptionStatsCell {
  unix: number;
  netGex?: number;
  netDex?: number;
  netChex?: number;
  grossGex: number;
  grossDex: number;
  grossChex: number;
  gexRatio?: number;
  dexRatio?: number;
  chexRatio?: number;
  gexChange?: number;
  dexChange?: number;
  chexChange?: number;
  wholeNetGex: number;
  wholeNetDex: number;
  wholeNetChex: number;
  keyGammaStrike?: number;
  keyDeltaStrike?: number;
  keyCharmStrike?: number;
  windowLow: number;
  windowHigh: number;
  qualityFlags: number;
  sourceUnix: number;
}

export interface OptionStatsModel {
  points: Map<number, OptionStatsCell>;
  barTimes: number[];
}

export function sanitizeOptionStatsMetrics(value: unknown): OptionStatsMetric[] {
  const allowed = new Set<OptionStatsMetric>(OPTION_STATS_METRICS.map((metric) => metric.key));
  const selected = Array.isArray(value) ? [...new Set(value.filter((item): item is OptionStatsMetric => typeof item === "string" && allowed.has(item as OptionStatsMetric)))] : [];
  return selected.length ? selected : [...DEFAULT_OPTION_STATS_METRICS];
}

export function optionStatsValue(point: OptionStatsPoint, metric: OptionStatsMetric): number | undefined {
  const value = metric === "netGex" ? point.net_gex : metric === "netDex" ? point.net_delta_notional : point.net_charm_notional;
  return value === 0 && (point.quality_flags & QUALITY_MISSING_OI) !== 0 ? undefined : value;
}

function ratio(net: number | undefined, gross: number) {
  return typeof net === "number" && gross > 0 ? Math.max(-1, Math.min(1, net / gross)) : undefined;
}

export function optionStatsRatio(point: OptionStatsCell | undefined, metric: OptionStatsMetric) {
  return metric === "netGex" ? point?.gexRatio : metric === "netDex" ? point?.dexRatio : point?.chexRatio;
}

/** Exact timestamp join only; a missing option minute is never forward-filled. */
export function buildOptionStatsModel(response: OptionStatsResponse | undefined, bars: IntradayBar[]): OptionStatsModel {
  const barTimes = bars.map((bar) => bar.unix);
  const barSet = new Set(barTimes);
  const points = new Map<number, OptionStatsCell>();
  let previous: OptionStatsCell | undefined;
  for (const point of response?.points ?? []) {
    const netGex = optionStatsValue(point, "netGex");
    const netDex = optionStatsValue(point, "netDex");
    const netChex = optionStatsValue(point, "netChex");
    const contiguous = !!previous && point.unix - previous.unix === response?.timeframe;
    const cell: OptionStatsCell = {
      unix: point.unix,
      netGex,
      netDex,
      netChex,
      grossGex: point.gross_gex,
      grossDex: point.gross_delta_notional,
      grossChex: point.gross_charm_notional,
      gexRatio: ratio(netGex, point.gross_gex),
      dexRatio: ratio(netDex, point.gross_delta_notional),
      chexRatio: ratio(netChex, point.gross_charm_notional),
      gexChange: contiguous && typeof netGex === "number" && typeof previous?.netGex === "number" ? netGex - previous.netGex : undefined,
      dexChange: contiguous && typeof netDex === "number" && typeof previous?.netDex === "number" ? netDex - previous.netDex : undefined,
      chexChange: contiguous && typeof netChex === "number" && typeof previous?.netChex === "number" ? netChex - previous.netChex : undefined,
      wholeNetGex: point.whole_net_gex,
      wholeNetDex: point.whole_net_delta_notional,
      wholeNetChex: point.whole_net_charm_notional,
      keyGammaStrike: point.key_gamma_strike,
      keyDeltaStrike: point.key_delta_strike,
      keyCharmStrike: point.key_charm_strike,
      windowLow: point.window_low,
      windowHigh: point.window_high,
      qualityFlags: point.quality_flags,
      sourceUnix: point.source_unix,
    };
    previous = cell;
    if (!barSet.has(point.unix)) continue;
    points.set(point.unix, cell);
  }
  return { points, barTimes };
}
