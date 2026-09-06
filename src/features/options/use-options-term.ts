import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getOptionTerm,
  type OptionProduct,
  type OptionScope,
  type OptionsTermResponse,
} from "../../api/options";

export const optionsTermKeys = {
  all: ["options-term"] as const,
  detail: (product: OptionProduct, scope: OptionScope) =>
    [...optionsTermKeys.all, product, scope] as const,
};

export function useOptionsTerm(product: OptionProduct, scope: OptionScope = "d90") {
  return useQuery({
    queryKey: optionsTermKeys.detail(product, scope),
    queryFn: ({ signal }) => getOptionTerm(product, scope, signal),
    // R3：真实数据由快照版本驱动失效（useSnapshotSync），同版本不重复请求；
    // 仅 local-demo（无采集器）保留 60s 轮询维持演示跳动
    staleTime: 30_000,
    refetchInterval: (query) =>
      (query.state.data as { source?: string } | undefined)?.source === "local-demo"
        ? 60_000
        : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * 一·五节联动模型：10 面板多 scope 叠加——缓存 key 仍单 scope，
 * 前端按 scopes 并发取多 key（React Query 去重），服务端零新增计算。
 */
export function useOptionsTermMulti(product: OptionProduct, scopes: OptionScope[], _pcr = false) {
  return useQueries({
    queries: scopes.map((scope) => ({
      queryKey: [...optionsTermKeys.detail(product, scope), _pcr ? "pcr" : "iv"],
      queryFn: ({ signal }: { signal: AbortSignal }) => getOptionTerm(product, scope, signal),
      staleTime: 30_000,
      refetchInterval: false as const,
      refetchIntervalInBackground: false,
    })),
  }) as Array<{ data?: OptionsTermResponse; isPending: boolean; isError: boolean }>;
}
