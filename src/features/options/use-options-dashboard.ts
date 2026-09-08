import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getOptionDashboard,
  type OptionProduct,
  type OptionScope,
} from "../../api/options";

export const optionsDashboardKeys = {
  all: ["options-dashboard"] as const,
  detail: (product: OptionProduct, scope: OptionScope, days = 20) =>
    [...optionsDashboardKeys.all, product, scope, days, 0.12] as const,
};

export function useOptionsDashboard(
  product: OptionProduct,
  scope: OptionScope,
  opts?: { enabled?: boolean; days?: number },
) {
  return useQuery({
    queryKey: optionsDashboardKeys.detail(product, scope, opts?.days ?? 20),
    queryFn: ({ signal }) => getOptionDashboard(product, scope, signal, opts?.days),
    // 06 内嵌 VP 条带（第二十轮）用 enabled 门控：VP 关时不取数
    enabled: opts?.enabled ?? true,
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

/** 07 微笑多 scope 叠加：并发取多 scope 的 dashboard（单 scope 缓存 key，React Query 去重） */
export function useOptionsDashboardMulti(
  product: OptionProduct,
  scopes: OptionScope[],
  enabled: boolean | boolean[] = true,
) {
  return useQueries({
    queries: scopes.map((scope, index) => ({
      queryKey: optionsDashboardKeys.detail(product, scope),
      queryFn: ({ signal }: { signal: AbortSignal }) => getOptionDashboard(product, scope, signal),
      enabled: Array.isArray(enabled) ? enabled[index] !== false : enabled,
      staleTime: 30_000,
      refetchInterval: ((query: { state: { data?: { source?: string } } }) =>
        query.state.data?.source === "local-demo" ? 60_000 : false) as never,
      refetchIntervalInBackground: false,
    })),
  }) as Array<{
    data?: import("../../api/options").OptionsDashboardResponse;
    isPending: boolean;
    isError: boolean;
  }>;
}
