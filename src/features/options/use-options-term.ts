import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getOptionTerm,
  type OptionProduct,
  type OptionScope,
  type OptionsTermResponse,
} from "../../api/options";
import { scopeStaleTimeMs } from "./data-freshness";

export const optionsTermKeys = {
  all: ["options-term"] as const,
  detail: (product: OptionProduct, scope: OptionScope) =>
    [...optionsTermKeys.all, product, scope] as const,
};

export function useOptionsTerm(product: OptionProduct, scope: OptionScope = "d90", enabled = true) {
  return useQuery({
    queryKey: optionsTermKeys.detail(product, scope),
    queryFn: ({ signal }) => getOptionTerm(product, scope, signal),
    enabled,
    // 刷新由 useSnapshotSync 版本失效驱动（data-freshness 调度器按档分频），本地不挂定时器。
    staleTime: scopeStaleTimeMs(scope),
  });
}

/**
 * 一·五节联动模型：10 面板多 scope 叠加——缓存 key 仍单 scope，
 * 前端按 scopes 并发取多 key（React Query 去重），服务端零新增计算。
 */
export function useOptionsTermMulti(product: OptionProduct, scopes: OptionScope[], _pcr = false, enabled = true) {
  return useQueries({
    queries: scopes.map((scope) => ({
      queryKey: [...optionsTermKeys.detail(product, scope), _pcr ? "pcr" : "iv"],
      queryFn: ({ signal }: { signal: AbortSignal }) => getOptionTerm(product, scope, signal),
      enabled,
      staleTime: scopeStaleTimeMs(scope),
      refetchInterval: false as const,
      refetchIntervalInBackground: false,
    })),
  }) as Array<{ data?: OptionsTermResponse; isPending: boolean; isError: boolean }>;
}
