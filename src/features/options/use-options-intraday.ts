import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getOptionIntraday,
  getOptionIntradayBars,
  type OptionProduct,
  type OptionScope,
} from "../../api/options";

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
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
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
