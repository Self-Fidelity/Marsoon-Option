import { useQueries, useQuery } from "@tanstack/react-query";

import { getOptionChain, type OptionProduct, type OptionScope, type OptionsChainResponse } from "../../api/options";
import { scopeStaleTimeMs } from "./data-freshness";

export const optionsChainKeys = {
  all: ["options-chain"] as const,
  detail: (product: OptionProduct, expiration?: number, scope: OptionScope = "0dte", seriesId?: string) =>
    [...optionsChainKeys.all, product, expiration ?? "auto", scope, seriesId ?? "auto"] as const,
};

/** 09 期权链下钻：expiration 缺省时后端选 DTE 最小的 serie（与 BoardView 的自动查询同 key，共享缓存）。 */
export function useOptionsChain(product: OptionProduct, expiration?: number, scope: OptionScope = "0dte", enabled = true) {
  return useQuery({
    queryKey: optionsChainKeys.detail(product, expiration, scope),
    queryFn: ({ signal }) => getOptionChain(product, expiration, signal, scope),
    enabled,
    // 刷新由 useSnapshotSync 版本失效驱动（data-freshness 调度器按档分频），本地不挂定时器。
    staleTime: scopeStaleTimeMs(scope),
  });
}

export function useOptionsChainMulti(
  product: OptionProduct,
  scopes: OptionScope[],
  selectedSeries: Record<string, string> = {},
  enabled = true,
) {
  return useQueries({
    queries: scopes.map((scope) => {
      const seriesId = selectedSeries[`${product}:${scope}`];
      return {
        queryKey: optionsChainKeys.detail(product, undefined, scope, seriesId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getOptionChain(product, undefined, signal, scope, seriesId),
        enabled,
        staleTime: scopeStaleTimeMs(scope),
        refetchInterval: false as const,
        refetchIntervalInBackground: false,
      };
    }),
  }) as Array<{ data?: OptionsChainResponse; isPending: boolean; isError: boolean }>;
}
