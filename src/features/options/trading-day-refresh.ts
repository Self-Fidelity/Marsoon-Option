"use client";

import { useEffect, useState } from "react";

const chicago = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** CME trading day changes at 17:00 CT; the Friday key stays active until Sunday 17:00 CT. */
export function cmeTradingDayKey(nowMs = Date.now()): string {
  const parts = Object.fromEntries(
    chicago.formatToParts(nowMs).map((part) => [part.type, Number(part.value)]),
  );
  let day = Date.UTC(parts.year!, parts.month! - 1, parts.day!);
  const weekday = new Date(day).getUTCDay();
  if (weekday === 6) day -= 86400000;
  else if (weekday === 0) day += parts.hour! >= 17 ? 86400000 : -2 * 86400000;
  else if (weekday !== 5 && parts.hour! >= 17) day += 86400000;
  return new Date(day).toISOString().slice(0, 10);
}

/** Local minute timer only changes the query key when the CME trading day changes. */
export function useCmeTradingDayKey(): string {
  const [key, setKey] = useState(() => cmeTradingDayKey());
  useEffect(() => {
    const update = () => setKey((current) => {
      const next = cmeTradingDayKey();
      return next === current ? current : next;
    });
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return key;
}

export const tradingDayQueryPolicy = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 3 * 86400000,
  refetchInterval: false as const,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};
