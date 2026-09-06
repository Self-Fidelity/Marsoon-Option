import type { IntradayBar, OptionProduct, OptionsIntradayResponse } from "@/api/options";

type ReadAPI = (path: string, query: Record<string, string | number | undefined>) => Promise<unknown>;
const chicago = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** The trading date starts at 17:00 Chicago on the previous calendar day. */
export function sessionStart(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("交易日期无效");
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) throw new Error("交易日期无效");
  const localWall = midnight - 86400000 + 17 * 3600000;
  let instant = localWall + 6 * 3600000;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(chicago.formatToParts(instant).map((p) => [p.type, Number(p.value)]));
    const observedWall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    instant += localWall - observedWall;
  }
  return instant / 1000;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cmeTradingDay(unix: number): string {
  const parts = Object.fromEntries(chicago.formatToParts(unix * 1000).map((p) => [p.type, Number(p.value)]));
  let day = Date.UTC(parts.year!, parts.month! - 1, parts.day!);
  if (parts.hour! >= 17) day += 86400000;
  return new Date(day).toISOString().slice(0, 10);
}

function latestTradingDayBars(bars: IntradayBar[]): IntradayBar[] {
  const latest = bars.at(-1);
  if (!latest) return [];
  const day = cmeTradingDay(latest.unix);
  return bars.filter((bar) => cmeTradingDay(bar.unix) === day);
}
export function validMinuteBars(value: unknown, from: number, to: number): IntradayBar[] {
  if (!Array.isArray(value)) return [];
  const byTime = new Map<number, IntradayBar>();
  for (const item of value) {
    const b = record(item);
    const open = typeof b.open === "number" ? b.open : b.o;
    const high = typeof b.high === "number" ? b.high : b.h;
    const low = typeof b.low === "number" ? b.low : b.l;
    const close = typeof b.close === "number" ? b.close : b.c;
    const volume = typeof b.volume === "number" ? b.volume : b.v;
    if (![b.unix, open, high, low, close, volume].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    const bar: IntradayBar = { unix: b.unix as number, open: open as number, high: high as number, low: low as number, close: close as number, volume: volume as number, final: b.final as boolean | undefined };
    if (!Number.isSafeInteger(bar.unix) || bar.unix % 60 !== 0 || bar.unix < from || bar.unix >= to || bar.volume < 0 || bar.low <= 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) continue;
    // Repeated snapshots replace a minute; they never add its volume again.
    byTime.set(bar.unix, bar);
  }
  return [...byTime.values()].sort((a, b) => a.unix - b.unix);
}

/** Only compose the existing Go HTTP interfaces. No vendor subscriptions or DB writes. */
export async function attachAvailableCandles(
  data: OptionsIntradayResponse,
  product: OptionProduct,
  read: ReadAPI,
  now?: number,
  fixedUnderlying?: string,
  range?: { from: number; to: number },
): Promise<OptionsIntradayResponse> {
  const at = now ?? Math.floor(Date.now() / 1000);
  const optionUnderlying = (data.underlying_symbol ?? fixedUnderlying)?.toUpperCase();
  if (!optionUnderlying) return data;
  if (data.bars.length) return { ...data, candle_underlying_symbol: optionUnderlying, candle_is_reference: false };
  const from = range?.from ?? sessionStart(data.day);
  const to = range?.to ?? Math.floor(at / 60) * 60 + 1;
  if (to <= from || to - from > 7 * 86400) return data;
  const fetchBars = async (symbol: string, rangeFrom = from, rangeTo = to) => {
    const response = record(await read("/options/underlying-bars", { product, underlying: symbol, from: rangeFrom, to: rangeTo, timeframe: 60 }));
    if (response.underlying_symbol !== symbol) return [];
    return validMinuteBars(response.bars, rangeFrom, rangeTo);
  };
  const own = await fetchBars(optionUnderlying);
  if (own.length) return { ...data, has_data: true, bars: own, candle_underlying_symbol: optionUnderlying, candle_is_reference: false };

  const status = record(await read("/options/status", {}));
  const entries = Array.isArray(status.entries) ? status.entries.map(record) : [];
  const symbols = [...new Set(entries
    .filter((e) => e.product === product && e.scope === "nearest" && typeof e.expiration === "number" && e.expiration > at && typeof e.underlying_symbol === "string" && e.underlying_symbol !== optionUnderlying)
    .sort((a, b) => Number(a.expiration) - Number(b.expiration))
    .map((e) => String(e.underlying_symbol)))].slice(0, 3);
  for (const symbol of symbols) {
    const bars = await fetchBars(symbol);
    if (bars.length) return {
      ...data, has_data: true, bars, candle_underlying_symbol: symbol, candle_is_reference: true,
      candle_notice: `K线参考合约 ${symbol}；期权标的 ${optionUnderlying} 暂无K线，异合约水位与GEX不叠加。`,
    };
  }
  // Closed weekends and holidays can leave the requested one-day window empty.
  // Read one bounded history window and show only its latest real CME day.
  if (to - from <= 2 * 86400) {
    const previousFrom = to - 7 * 86400;
    const previousOwn = latestTradingDayBars(await fetchBars(optionUnderlying, previousFrom, to));
    if (previousOwn.length) return {
      ...data,
      has_data: true,
      bars: previousOwn,
      candle_underlying_symbol: optionUnderlying,
      candle_is_reference: false,
      candle_notice: `当前时段暂无分钟K线，显示最近有数据的 CME 交易日（${cmeTradingDay(previousOwn.at(-1)!.unix)}）。`,
    };
    for (const symbol of symbols) {
      const previousReference = latestTradingDayBars(await fetchBars(symbol, previousFrom, to));
      if (previousReference.length) return {
        ...data,
        has_data: true,
        bars: previousReference,
        candle_underlying_symbol: symbol,
        candle_is_reference: true,
        candle_notice: `当前时段暂无分钟K线，显示最近交易日参考合约 ${symbol}；期权标的 ${optionUnderlying} 的异合约水位与 GEX 不叠加。`,
      };
    }
  }
  return { ...data, candle_underlying_symbol: optionUnderlying, candle_notice: `后端暂无 ${optionUnderlying} 的分钟K线，也没有可用的参考合约K线。` };
}
