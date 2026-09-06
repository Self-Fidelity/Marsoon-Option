import { useQuery } from "@tanstack/react-query";

import { getOptionLevels, type OptionProduct, type OptionScope } from "@/api/options";

export const optionsLevelsKeys = {
  all: ["options-levels"] as const,
  detail: (product: OptionProduct, scope: OptionScope) =>
    [...optionsLevelsKeys.all, product, scope, 300] as const,
};

export function useOptionsLevels(product: OptionProduct, scope: OptionScope) {
  return useQuery({
    queryKey: optionsLevelsKeys.detail(product, scope),
    queryFn: ({ signal }) => getOptionLevels(product, scope, signal),
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
