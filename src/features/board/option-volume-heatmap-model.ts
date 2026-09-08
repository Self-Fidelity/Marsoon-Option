import type { OptionVolumeHeatmapResponse } from "@/api/options";

export type OptionVolumeHeatmapMetric = "difference" | "total" | "call" | "put" | "ratio";
export type OptionVolumeHeatmapWindow = "1m" | "5m" | "session";

export interface OptionVolumeHeatmapCell {
  unix: number;
  strike: number;
  call: number;
  put: number;
  total: number;
  difference: number;
  ratio: number | null;
  callTrades: number;
  putTrades: number;
}

export interface OptionVolumeHeatmapModel {
  cells: OptionVolumeHeatmapCell[];
  metric: OptionVolumeHeatmapMetric;
  window: OptionVolumeHeatmapWindow;
  maxAbs: number;
  fallback: boolean;
  fallbackDays: number;
}

function percentile95(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)]! : 1;
}

export function optionVolumeHeatmapValue(cell: OptionVolumeHeatmapCell, metric: OptionVolumeHeatmapMetric): number | null {
  if (metric === "call") return cell.call;
  if (metric === "put") return cell.put;
  if (metric === "total") return cell.total;
  if (metric === "ratio") return cell.ratio;
  return cell.difference;
}

export function buildOptionVolumeHeatmapModel(
  response: OptionVolumeHeatmapResponse,
  metric: OptionVolumeHeatmapMetric,
  window: OptionVolumeHeatmapWindow,
): OptionVolumeHeatmapModel {
  const span = window === "5m" ? 300 : 60;
  const buckets = new Map<string, OptionVolumeHeatmapCell>();
  for (const row of response.rows) {
    const unix = Math.floor(row.unix / span) * span;
    const key = `${unix}|${row.strike}`;
    const call = row.call_buy_contracts + row.call_sell_contracts + row.call_unknown_contracts;
    const put = row.put_buy_contracts + row.put_sell_contracts + row.put_unknown_contracts;
    const cell = buckets.get(key) ?? { unix, strike: row.strike, call: 0, put: 0, total: 0, difference: 0, ratio: null, callTrades: 0, putTrades: 0 };
    cell.call += call; cell.put += put; cell.callTrades += row.call_trades; cell.putTrades += row.put_trades;
    cell.total = cell.call + cell.put; cell.difference = cell.call - cell.put;
    cell.ratio = cell.total > 0 ? cell.difference / cell.total : null;
    buckets.set(key, cell);
  }
  let cells = [...buckets.values()].sort((a, b) => a.unix - b.unix || a.strike - b.strike);
  if (window === "session") {
    const cumulative = new Map<number, OptionVolumeHeatmapCell>();
    const output: OptionVolumeHeatmapCell[] = [];
    for (const unix of [...new Set(cells.map((cell) => cell.unix))]) {
      for (const cell of cells.filter((item) => item.unix === unix)) {
        const old = cumulative.get(cell.strike) ?? { ...cell, call: 0, put: 0, total: 0, difference: 0, ratio: null, callTrades: 0, putTrades: 0 };
        old.call += cell.call; old.put += cell.put; old.callTrades += cell.callTrades; old.putTrades += cell.putTrades;
        old.total = old.call + old.put; old.difference = old.call - old.put; old.ratio = old.total > 0 ? old.difference / old.total : null;
        cumulative.set(cell.strike, old);
      }
      for (const cell of cumulative.values()) output.push({ ...cell, unix });
    }
    cells = output;
  }
  const magnitudes = cells.map((cell) => Math.abs(optionVolumeHeatmapValue(cell, metric) ?? 0));
  return { cells, metric, window, maxAbs: Math.max(1e-9, percentile95(magnitudes)), fallback: response.fallback, fallbackDays: response.fallback_days };
}
