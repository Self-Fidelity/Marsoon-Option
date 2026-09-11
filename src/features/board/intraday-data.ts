import type { IntradayBar, OptionsDashboardResponse, OptionsIntradayResponse, OptionScope } from "@/api/options";

type Segment = { scope: OptionScope; data?: OptionsIntradayResponse };

/** 并集合并（按 unix 去重，后者覆盖前者），升序返回。K 线缓存的"只增不减"合并用。
 *  两个序列合约符号不一致时以新序列 b 整体替换（同 resetClosedDay 语义），避免跨合约价差画成跳空。 */
export function unionBars(a: readonly IntradayBar[], b: readonly IntradayBar[], aSymbol?: string, bSymbol?: string): IntradayBar[] {
  if (aSymbol && bSymbol && aSymbol.toUpperCase() !== bSymbol.toUpperCase()) return [...b];
  if (!a.length) return [...b];
  if (!b.length) return [...a];
  const byTime = new Map<number, IntradayBar>();
  for (const bar of a) byTime.set(bar.unix, bar);
  for (const bar of b) byTime.set(bar.unix, bar);
  return [...byTime.values()].sort((x, y) => x.unix - y.unix);
}
export function candleUnderlying(data?: OptionsIntradayResponse): string | undefined {
  return (data?.candle_underlying_symbol ?? data?.underlying_symbol)?.toUpperCase();
}
export function pickIntradayBars(segments: Segment[], primary: OptionScope): OptionsIntradayResponse | undefined {
  return segments.find((s) => s.scope === primary && s.data?.bars.length)?.data
    ?? segments.find((s) => s.data?.bars.length)?.data;
}
export function sameUnderlying(a?: string, b?: string): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
}

/** Let the independent candle request paint first while option layers continue loading. */
export function mergeCandlePayload(
  data: OptionsIntradayResponse | undefined,
  candles: OptionsIntradayResponse | undefined,
): OptionsIntradayResponse | undefined {
  if (!candles?.bars.length) return data;
  if (!data) return candles;
  return {
    ...data,
    has_data: true,
    missing_reason: undefined,
    /** K 线历史只增不减（2026-09-10）：上游任何一次"瞬时缺数据"的响应都不允许抹掉已有历史。 */
    bars: unionBars(data.bars, candles.bars, data.candle_underlying_symbol, candles.candle_underlying_symbol),
    candle_underlying_symbol: candles.candle_underlying_symbol ?? data.candle_underlying_symbol,
    candle_is_reference: candles.candle_is_reference,
    candle_notice: candles.candle_notice,
  };
}

/** Overlay current option levels from dashboard onto the candle payload. */
export function mergeDashboardCurrent(
  data: OptionsIntradayResponse | undefined,
  dashboard: OptionsDashboardResponse | undefined,
): OptionsIntradayResponse | undefined {
  if (!data) return undefined;
  if (!dashboard || dashboard.has_data === false) return data;
  const summary = dashboard?.summary;
  const market = dashboard?.market_state;
  if (!summary && !market) return data;
  const dataUnderlying = candleUnderlying(data);
  const dashboardUnderlying = (market?.underlying_symbol ?? dashboard.underlying_symbol)?.toUpperCase();
  if (dataUnderlying && dashboardUnderlying && dataUnderlying !== dashboardUnderlying) return data;
  const spot = data.current?.spot ?? market?.underlying_price ?? summary?.underlying_price ?? null;
  const expectedMove = data.current?.expected_move ?? (
    typeof summary?.expected_move_upper === "number" && typeof summary.expected_move_lower === "number"
      ? Math.abs(summary.expected_move_upper - summary.expected_move_lower) / 2
      : typeof spot === "number" && typeof summary?.expected_move_upper === "number"
        ? Math.abs(summary.expected_move_upper - spot)
        : typeof spot === "number" && typeof summary?.expected_move_lower === "number"
          ? Math.abs(spot - summary.expected_move_lower)
          : null
  );
  return {
    ...data,
    current: {
      captured_at: data.current?.captured_at ?? dashboard?.snapshot_unix ?? 0,
      spot,
      call_wall: summary?.call_wall ?? market?.call_wall ?? data.current?.call_wall ?? null,
      put_wall: summary?.put_wall ?? market?.put_wall ?? data.current?.put_wall ?? null,
      gamma_flip: summary?.gamma_flip ?? market?.gamma_flip ?? data.current?.gamma_flip ?? null,
      atm_iv: summary?.atm_iv ?? data.current?.atm_iv ?? null,
      expected_move: expectedMove,
    },
  };
}
