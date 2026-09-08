import type { IntradayBar, OptionsIntradayResponse } from "@/api/options";

const CANDLE_STREAM = 4;

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface CandleStreamBatch {
  symbol: string;
  timeframe: number;
  bars: IntradayBar[];
}

/** Decode the existing market-data websocket envelope. Historical getrange chunks are ignored. */
export function parseCandleStreamMessage(text: string): CandleStreamBatch | null {
  let envelope: Row;
  try { envelope = record(JSON.parse(text)); } catch { return null; }
  if (envelope.stream !== CANDLE_STREAM || typeof envelope.data !== "string" || envelope.request_id) return null;

  let payload: Row;
  try { payload = record(JSON.parse(decodeBase64(envelope.data))); } catch { return null; }
  const pair = record(payload.pair ?? envelope.pair);
  const symbol = typeof pair.symbol === "string" ? pair.symbol.toUpperCase() : "";
  const timeframe = finite(payload.timeframe ?? envelope.timeframe);
  const values = Array.isArray(payload.values) ? payload.values : [];
  if (!symbol || timeframe !== 60) return null;

  const byTime = new Map<number, IntradayBar>();
  for (const value of values) {
    const row = record(value);
    const unix = finite(row.unix), open = finite(row.open), high = finite(row.high), low = finite(row.low), close = finite(row.close);
    const vbuy = finite(row.vbuy) ?? 0, vsell = finite(row.vsell) ?? 0, vunknown = finite(row.vunknown) ?? 0;
    const volume = vbuy + vsell + vunknown;
    if (unix === null || open === null || high === null || low === null || close === null) continue;
    if (!Number.isSafeInteger(unix) || unix % 60 || unix <= 0 || low <= 0 || low > Math.min(open, close) || high < Math.max(open, close) || volume < 0) continue;
    byTime.set(unix, { unix, open, high, low, close, volume, final: row.final === true });
  }
  const bars = [...byTime.values()].sort((a, b) => a.unix - b.unix);
  return bars.length ? { symbol, timeframe, bars } : null;
}

/** Upsert websocket tail bars without accumulating repeated minute volume. */
export function mergeCandleStreamBars(
  current: OptionsIntradayResponse | undefined,
  batch: CandleStreamBatch,
  historyDays: number,
): OptionsIntradayResponse | undefined {
  if (!current) return current;
  const currentSymbol = (current.candle_underlying_symbol ?? current.underlying_symbol)?.toUpperCase();
  if (currentSymbol && currentSymbol !== batch.symbol) return current;

  const existing = current.bars ?? [];
  const incomingFirst = batch.bars[0]!.unix;
  const existingLast = existing.at(-1)?.unix;
  const resetClosedDay = historyDays === 1 && existingLast !== undefined && incomingFirst - existingLast > 6 * 3600;
  const byTime = new Map<number, IntradayBar>();
  if (!resetClosedDay) for (const bar of existing) byTime.set(bar.unix, bar);
  for (const bar of batch.bars) byTime.set(bar.unix, bar);

  const sorted = [...byTime.values()].sort((a, b) => a.unix - b.unix);
  const newest = sorted.at(-1)?.unix ?? 0;
  const cutoff = newest - Math.max(1, historyDays) * 86400;
  return {
    ...current,
    has_data: true,
    missing_reason: undefined,
    bars: sorted.filter((bar) => bar.unix >= cutoff),
    candle_underlying_symbol: batch.symbol,
    candle_is_reference: false,
  };
}
