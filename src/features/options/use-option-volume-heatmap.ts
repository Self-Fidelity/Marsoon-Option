import { useQuery } from "@tanstack/react-query";

import { getOptionVolumeHeatmap, type OptionProduct } from "@/api/options";

export function useOptionVolumeHeatmap(product: OptionProduct, from?: number, to?: number, enabled = true) {
  return useQuery({
    queryKey: ["option-volume-heatmap", product, from, to],
    queryFn: ({ signal }) => getOptionVolumeHeatmap(product, from!, to!, signal),
    enabled: enabled && !!from && !!to && to > from,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
