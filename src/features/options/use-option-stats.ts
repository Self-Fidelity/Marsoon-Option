import { useQuery } from "@tanstack/react-query";

import { getOptionStats, type OptionProduct } from "@/api/options";

export function useOptionStats(product: OptionProduct, from: number | undefined, to: number | undefined, timeframe: number, enabled: boolean) {
  return useQuery({
    queryKey: ["option-stats", product, "0dte", from, to, timeframe],
    queryFn: ({ signal }) => getOptionStats(product, from!, to!, timeframe, signal),
    enabled: enabled && !!from && !!to && to > from,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
