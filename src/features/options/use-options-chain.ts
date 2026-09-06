import { useQueries, useQuery } from "@tanstack/react-query";

import { getOptionChain, type OptionProduct, type OptionScope, type OptionsChainResponse } from "../../api/options";

export const optionsChainKeys = {
  all: ["options-chain"] as const,
  detail: (product: OptionProduct, expiration?: number, scope: OptionScope = "0dte", seriesId?: string) =>
    [...optionsChainKeys.all, product, expiration ?? "auto", scope, seriesId ?? "auto"] as const,
};

/** 09 期权链下钻：expiration 缺省时后端选 DTE 最小的 serie（与 BoardView 的自动查询同 key，共享缓存）。 */
export function useOptionsChain(product: OptionProduct, expiration?: number, scope: OptionScope = "0dte") {
  return useQuery({
    queryKey: optionsChainKeys.detail(product, expiration, scope),
    queryFn: ({ signal }) => getOptionChain(product, expiration, signal, scope),
    staleTime: 30_000,
    refetchInterval: (query) =>
      (query.state.data as { source?: string } | undefined)?.source === "local-demo"
        ? 60_000
        : false,
    refetchIntervalInBackground: false,
  });
}

export function useOptionsChainMulti(
  product: OptionProduct,
  scopes: OptionScope[],
  selectedSeries: Record<string, string> = {},
) {
  return useQueries({
    queries: scopes.map((scope) => {
      const seriesId = selectedSeries[`${product}:${scope}`];
      return {
        queryKey: optionsChainKeys.detail(product, undefined, scope, seriesId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getOptionChain(product, undefined, signal, scope, seriesId),
        staleTime: 30_000,
        refetchInterval: false as const,
        refetchIntervalInBackground: false,
      };
    }),
  }) as Array<{ data?: OptionsChainResponse; isPending: boolean; isError: boolean }>;
}
