import { useQuery } from "@tanstack/react-query";

import { getOptionVolumeProfile, type OptionProduct } from "@/api/options";

export function useOptionVolumeProfile(product: OptionProduct, from?: number, to?: number, enabled = true) {
  return useQuery({
    queryKey: ["option-volume-profile", product, from, to],
    queryFn: ({ signal }) => getOptionVolumeProfile(product, from!, to!, signal),
    enabled: enabled && !!from && !!to && to > from,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
