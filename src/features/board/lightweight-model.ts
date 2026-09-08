import type { IntradayBar, OptionScope, OptionsIntradayResponse } from "@/api/options";

export const INTRADAY_SCOPES: OptionScope[] = ["0dte", "d30", "d90", "close"];
export const POSITION_FIELDS = [
  { kind: "CW", field: "call_wall" },
  { kind: "PW", field: "put_wall" },
  { kind: "FLIP", field: "gamma_flip" },
] as const;
export type PositionKind = typeof POSITION_FIELDS[number]["kind"] | "SPOT";
export interface ChartPosition { kind: PositionKind; price: number; scopes: OptionScope[] }
export interface IntradaySegment { scope: OptionScope; data?: OptionsIntradayResponse }

/** Only aggregate real bars; repeat minutes replace rather than add volume. */
export function aggregateIntradayBars(input: readonly IntradayBar[], minutes: number): IntradayBar[] {
  const distinct = new Map<number, IntradayBar>();
  for (const bar of input) {
    if (!bar || typeof bar !== "object") continue;
    if (![bar.unix, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.unix <= 0 || bar.unix % 60 || bar.low <= 0 || bar.volume < 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) continue;
    distinct.set(bar.unix, bar);
  }
  const span = Math.max(1, minutes) * 60;
  const result: IntradayBar[] = [];
  for (const bar of [...distinct.values()].sort((a, b) => a.unix - b.unix)) {
    const unix = Math.floor(bar.unix / span) * span;
    const last = result.at(-1);
    if (last?.unix === unix) {
      last.high = Math.max(last.high, bar.high); last.low = Math.min(last.low, bar.low);
      last.close = bar.close; last.volume += bar.volume; last.final = !!last.final && !!bar.final;
    } else result.push({ ...bar, unix });
  }
  return result;
}
export function buildChartPositions(segments: IntradaySegment[], primary: OptionScope, symbol?: string, latestPrice?: number): ChartPosition[] {
  const positions: ChartPosition[] = [];
  for (const scope of INTRADAY_SCOPES) {
    const data = segments.find((s) => s.scope === scope)?.data;
    if (!data?.current) continue;
    if (symbol && data.underlying_symbol && data.underlying_symbol.toUpperCase() !== symbol.toUpperCase() && data.candle_underlying_symbol && data.candle_underlying_symbol.toUpperCase() !== symbol.toUpperCase()) continue;
    const fields: Array<{ kind: PositionKind; price: number | null }> = POSITION_FIELDS.map((f) => ({ kind: f.kind, price: data.current![f.field] }));
    if (scope === primary) fields.push({
      kind: "SPOT",
      price: latestPrice != null && Number.isFinite(latestPrice) && latestPrice > 0
        ? latestPrice
        : data.current.spot,
    });
    for (const { kind, price } of fields) {
      if (price == null || !Number.isFinite(price) || price <= 0) continue;
      const match = positions.find((p) => p.kind === kind && p.price === price);
      if (match) match.scopes.push(scope); else positions.push({ kind, price, scopes: [scope] });
    }
  }
  return positions;
}
export function tailUpdateStart(previous: IntradayBar[], next: IntradayBar[]): number | null {
  if (!previous.length || next.length < previous.length) return null;
  for (let i = 0; i < previous.length - 1; i++) {
    const a = previous[i]!, b = next[i]!;
    if (a.unix !== b.unix || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || a.volume !== b.volume) return null;
  }
  return previous.at(-1)!.unix === next[previous.length - 1]?.unix ? previous.length - 1 : null;
}

/** Keep a viewed candle anchored when a refresh fills older missing minutes. */
export function preserveLogicalRange(
  previous: IntradayBar[],
  next: IntradayBar[],
  visible: { from: number; to: number },
): { from: number; to: number } {
  if (!previous.length || !next.length) return visible;
  const delta = next.length - previous.length;
  if (delta === 0) return visible;
  const prevFirst = previous[0]!.unix;
  const nextFirst = next[0]!.unix;
  if (delta > 0 && nextFirst < prevFirst) {
    return { from: visible.from + delta, to: visible.to + delta };
  }
  if (delta < 0 && nextFirst > prevFirst) {
    return { from: visible.from + delta, to: visible.to + delta };
  }
  return visible;
}
