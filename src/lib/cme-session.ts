const chicagoDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
const chicagoClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** CME trading day changes at 17:00 CT; the Friday key stays active until Sunday 17:00 CT. */
export function cmeTradingDayKey(nowMs = Date.now()): string {
  const parts = Object.fromEntries(
    chicagoDate.formatToParts(nowMs).map((part) => [part.type, Number(part.value)]),
  );
  let day = Date.UTC(parts.year!, parts.month! - 1, parts.day!);
  const weekday = new Date(day).getUTCDay();
  if (weekday === 6) day -= 86400000;
  else if (weekday === 0) day += parts.hour! >= 17 ? 86400000 : -2 * 86400000;
  else if (weekday !== 5 && parts.hour! >= 17) day += 86400000;
  return new Date(day).toISOString().slice(0, 10);
}

function isoDay(value: string): string {
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("交易日期无效");
  return iso;
}

function shiftIsoDay(day: string, offset: number): string {
  return new Date(Date.parse(`${isoDay(day)}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}

/** The trading date starts at 17:00 Chicago on the previous calendar day. */
export function sessionStart(day: string): number {
  const iso = isoDay(day);
  const midnight = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== iso) throw new Error("交易日期无效");
  const localWall = midnight - 86400000 + 17 * 3600000;
  let instant = localWall + 6 * 3600000;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(chicagoClock.formatToParts(instant).map((p) => [p.type, Number(p.value)]));
    const observedWall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    instant += localWall - observedWall;
  }
  return instant / 1000;
}

function chicagoWeekdayHour(nowMs: number): { weekday: number; hour: number } {
  const parts = Object.fromEntries(
    chicagoDate.formatToParts(nowMs).map((part) => [part.type, Number(part.value)]),
  );
  const weekday = new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!)).getUTCDay();
  return { weekday, hour: parts.hour! };
}

/** Globex 开盘：周日 17:00 CT 至周五 16:00 CT，不含工作日 16:00–17:00 的日盘间歇。 */
export function isCmeSessionOpen(nowMs = Date.now()): boolean {
  const { weekday, hour } = chicagoWeekdayHour(nowMs);
  if (weekday === 6) return false;
  if (weekday === 0) return hour >= 17;
  if (weekday === 5) return hour < 16;
  return hour < 16 || hour >= 17;
}

/** 最近一根已完成交易日的 16:00 CT（周末/周一回看周五）。 */
export function lastCompletedEodAsof(nowMs = Date.now()): number {
  const { weekday, hour } = chicagoWeekdayHour(nowMs);
  const key = cmeTradingDayKey(nowMs);
  let day = key;
  if (weekday === 6 || (weekday === 0 && hour < 17) || (weekday === 5 && hour >= 16)) {
    day = key;
  } else {
    const keyWeekday = new Date(Date.parse(`${key}T00:00:00Z`)).getUTCDay();
    day = keyWeekday === 1 ? shiftIsoDay(key, -3) : shiftIsoDay(key, -1);
  }
  return sessionStart(day) + 23 * 3600;
}

/**
 * 结构快照 asof：收盘档永远取上一根完整结算；30D/90D 仅在闭市后回看该结算；
 * 0DTE 不跨交易日回退。
 */
export function structureSnapshotAsof(scope: "close" | "0dte" | "d30" | "d90" | string, nowMs = Date.now()): number | undefined {
  if (scope === "close") return lastCompletedEodAsof(nowMs);
  if (scope === "0dte") return undefined;
  if (scope === "d30" || scope === "d90") return isCmeSessionOpen(nowMs) ? undefined : lastCompletedEodAsof(nowMs);
  return undefined;
}

/** K 线回看：1 日按当前 CME 交易日开盘，而不是滚动 24 小时（周末否则会落到休市日）。 */
export function candleHistoryRange(days: number, offsetDays = 0, nowMs = Date.now()): { from: number; to: number; asof: number } {
  const span = days === 3 || days === 7 ? days : 1;
  const toMs = nowMs - Math.max(0, offsetDays) * 86400000;
  const to = Math.floor(toMs / 60_000) * 60 + 1;
  const from = sessionStart(shiftIsoDay(cmeTradingDayKey(toMs), 1 - span));
  const start = Math.max(Math.min(from, to - 60), to - 7 * 86400);
  return { from: start, to, asof: to - 1 };
}
