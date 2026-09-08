import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  getOptionIntraday,
  getOptionIntradayBars,
  type OptionProduct,
  type OptionScope,
} from "../../api/options";
import { mergeCandleStreamBars, parseCandleStreamMessage } from "../board/candle-stream";

export const optionsIntradayKeys = {
  all: ["options-intraday"] as const,
  detail: (product: OptionProduct, scope: OptionScope, days = 1, offsetDays = 0) =>
    [...optionsIntradayKeys.all, product, scope, days, offsetDays] as const,
  bars: (product: OptionProduct, days = 1, offsetDays = 0) =>
    [...optionsIntradayKeys.all, "bars-only", product, days, offsetDays] as const,
};

function historyRange(days: number, offsetDays: number) {
  const to = Math.floor(Date.now() / 60_000) * 60 + 1 - offsetDays * 86400;
  return { from: to - days * 86400, to, asof: to - 1 };
}

export function useOptionsIntraday(product: OptionProduct, scope: OptionScope) {
  return useQuery({
    queryKey: optionsIntradayKeys.detail(product, scope),
    queryFn: ({ signal }) => getOptionIntraday(product, scope, signal),
    // R3：真实数据由快照版本驱动失效（useSnapshotSync），同版本不重复请求；
    // 仅 local-demo（无采集器）保留 60s 轮询维持演示跳动
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useOptionsIntradayBars(product: OptionProduct, days = 1, offsetDays = 0) {
  return useQuery({
    queryKey: optionsIntradayKeys.bars(product, days, offsetDays),
    queryFn: ({ signal }) => getOptionIntradayBars(product, signal, historyRange(days, offsetDays)),
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

/** Initial history comes from HTTP once; the active 1m tail is maintained by the existing candles websocket. */
export function useOptionsCandleStream(
  product: OptionProduct,
  underlying: string | undefined,
  days = 1,
  offsetDays = 0,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const symbol = underlying?.toUpperCase();
    if (!symbol || offsetDays !== 0) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let openedOnce = false;
    const key = optionsIntradayKeys.bars(product, days, offsetDays);

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5));
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, delay);
    };

    const connect = async () => {
      try {
        const session = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
        if (!session.ok || stopped) { scheduleReconnect(); return; }
        const ticket = await fetch("/api/auth/candles-ws", { cache: "no-store", credentials: "include" });
        if (!ticket.ok || stopped) { scheduleReconnect(); return; }
        const body = await ticket.json() as { url?: unknown };
        if (typeof body.url !== "string") { scheduleReconnect(); return; }

        socket = new WebSocket(body.url);
        socket.binaryType = "arraybuffer";
        socket.onopen = () => {
          attempts = 0;
          socket?.send(JSON.stringify({ method: "subscribe", data: { stream: 4, pair: { exchange: "DATABENTO", symbol }, timeframe: 60 } }));
          if (openedOnce) void queryClient.refetchQueries({ queryKey: key, exact: true });
          openedOnce = true;
        };
        socket.onmessage = async (event) => {
          if (stopped) return;
          let text: string;
          if (typeof event.data === "string") text = event.data;
          else if (event.data instanceof ArrayBuffer) text = new TextDecoder().decode(event.data);
          else if (event.data instanceof Blob) text = await event.data.text();
          else return;
          const batch = parseCandleStreamMessage(text);
          if (!batch || batch.symbol !== symbol) return;
          queryClient.setQueryData(key, (current: import("../../api/options").OptionsIntradayResponse | undefined) =>
            mergeCandleStreamBars(current, batch, days));
        };
        socket.onerror = () => socket?.close();
        socket.onclose = scheduleReconnect;
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ method: "unsubscribe", data: { stream: 4, pair: { exchange: "DATABENTO", symbol }, timeframe: 60 } }));
      }
      socket?.close();
    };
  }, [days, offsetDays, product, queryClient, underlying]);
}

/**
 * 一·五节联动模型：06 面板多 scope 叠加——缓存 key 仍单 scope，
 * 前端按 scopes 并发取多 key（React Query 去重），回放游标按 key 各算一份（成本线性）。
 */
export function useOptionsIntradayMulti(product: OptionProduct, scopes: OptionScope[], days = 1, offsetDays = 0) {
  // useQueries 支持动态长度数组，避免变长 hooks 调用
  return useQueries({
    queries: scopes.map((scope) => ({
      queryKey: optionsIntradayKeys.detail(product, scope, days, offsetDays),
      queryFn: ({ signal }: { signal: AbortSignal }) => getOptionIntraday(product, scope, signal, historyRange(days, offsetDays)),
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    })),
  }) as Array<{
    data?: import("../../api/options").OptionsIntradayResponse;
    isPending: boolean;
    isError: boolean;
  }>;
}
