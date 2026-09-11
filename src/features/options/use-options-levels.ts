import { useQuery } from "@tanstack/react-query";

import { getOptionLevels, type OptionProduct, type OptionScope } from "@/api/options";
import { scopeStaleTimeMs } from "./data-freshness";

export const optionsLevelsKeys = {
  all: ["options-levels"] as const,
  detail: (product: OptionProduct, scope: OptionScope) =>
    [...optionsLevelsKeys.all, product, scope, 300] as const,
};

export function useOptionsLevels(product: OptionProduct, scope: OptionScope, enabled = true) {
  return useQuery({
    queryKey: optionsLevelsKeys.detail(product, scope),
    queryFn: ({ signal }) => getOptionLevels(product, scope, signal),
    enabled,
    // 刷新由 useSnapshotSync 版本失效驱动（data-freshness 调度器按档分频），本地不挂定时器。
    staleTime: scopeStaleTimeMs(scope),
  });
}
