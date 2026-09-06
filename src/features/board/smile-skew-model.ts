import { optionSeriesName } from "@/lib/instrument-labels";
import type { OptionsChainResponse, OptionScope, OptionProduct } from "@/api/options";
import { optionProductConfig } from "@/api/options";
import type { DashboardViewModel } from "../options/dashboard-view-model";

/** 07 微笑偏斜面板的单点：选中到期下某执行价的 call/put IV */
export interface SmilePoint {
  strike: number;
  callIV?: number;
  putIV?: number;
}

/**
 * 07 波动率微笑偏斜面板的输入契约。
 * 数据来自 dashboard ViewModel 的 gammaRows（已按 MarketState 到期过滤、现货附近 11 档）。
 */
export interface SmileSkewModel {
  referenceLabel?: string;
  points: SmilePoint[];
  spot?: number;
  atmIV?: number;
  tickSize: number;
  scope: string;
}

export function buildSmileSkewModel(viewModel: DashboardViewModel): SmileSkewModel {
  const spot = viewModel.spot;
  const fromCells = viewModel.heatmapCells
    .map((cell) => ({
      strike: cell.strike,
      callIV: typeof cell.call_iv === "number" && Number.isFinite(cell.call_iv) ? cell.call_iv : undefined,
      putIV: typeof cell.put_iv === "number" && Number.isFinite(cell.put_iv) ? cell.put_iv : undefined,
      expiration: cell.expiration,
    }))
    .filter((point) => point.callIV != null || point.putIV != null);
  const byStrike = new Map<number, SmilePoint>();
  const nearby = fromCells.filter((point) => spot == null || Math.abs(point.strike - spot) / Math.max(spot, 1) <= 0.12);
  const source = nearby.length >= 8 ? nearby : fromCells;
  for (const point of source) {
    const existing = byStrike.get(point.strike);
    if (!existing) byStrike.set(point.strike, { strike: point.strike, callIV: point.callIV, putIV: point.putIV });
  }
  const points = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const fallback = viewModel.gammaRows
    .map((row) => ({ strike: row.strike, callIV: row.callIV, putIV: row.putIV }))
    .filter((point) => point.callIV != null || point.putIV != null)
    .sort((a, b) => a.strike - b.strike);
  return {
    points: points.length ? points : fallback,
    spot: viewModel.spot,
    atmIV: viewModel.atmIV,
    tickSize: viewModel.tickSize,
    scope: viewModel.scope,
  };
}

export function buildChainSmileModel(data: OptionsChainResponse, product: OptionProduct, scope: OptionScope): SmileSkewModel | null {
  const chain = data.chain; if (!chain || !data.has_data) return null;
  return { scope, referenceLabel: optionSeriesName(chain, product), tickSize: optionProductConfig[product].tickSize,
    spot: chain.underlying_price > 0 ? chain.underlying_price : undefined, atmIV: chain.atm_iv ?? undefined,
    points: chain.rows.map((r) => ({strike:r.strike,callIV:r.call?.iv ?? undefined,putIV:r.put?.iv ?? undefined})).filter((p) => p.callIV !== undefined || p.putIV !== undefined) };
}
