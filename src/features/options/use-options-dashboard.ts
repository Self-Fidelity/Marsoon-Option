import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getOptionDashboard,
  type OptionProduct,
  type OptionScope,
} from "../../api/options";
import { scopeStaleTimeMs } from "./data-freshness";

export const optionsDashboardKeys = {
  all: ["options-dashboard"] as const,
  // days 缺省 = "auto"（BFF 按 scope 给默认口径：0dte=1/d30=30/d90=90/close=45），
  // 前端不再恒传 20 顶掉服务端口径。
  detail: (product: OptionProduct, scope: OptionScope, days?: number) =>
    [...optionsDashboardKeys.all, product, scope, days ?? "auto", 0.12] as const,
};

export function useOptionsDashboard(
  product: OptionProduct,
  scope: OptionScope,
  opts?: { enabled?: boolean; days?: number },
) {
  return useQuery({
    queryKey: optionsDashboardKeys.detail(product, scope, opts?.days),
    queryFn: ({ signal }) => getOptionDashboard(product, scope, signal, opts?.days),
    // 06 内嵌 VP 条带（第二十轮）用 enabled 门控：VP 关时不取数
    enabled: opts?.enabled ?? true,
    // 刷新由 useSnapshotSync 版本失效驱动（data-freshness 调度器按档分频），本地不挂定时器。
    // staleTime 与调度消费节奏对齐：挂载/本地恢复不比后端产出更勤地重拉。
    staleTime: scopeStaleTimeMs(scope),
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
      staleTime: scopeStaleTimeMs(scope),
    })),
  }) as Array<{
    data?: import("../../api/options").OptionsDashboardResponse;
    isPending: boolean;
    isError: boolean;
  }>;
}
