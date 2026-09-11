import { useQuery } from "@tanstack/react-query";

import { getOptionVolumeProfile, type OptionProduct } from "@/api/options";
import { cmeTradingDayKey } from "@/lib/cme-session";
import { scopeStaleTimeMs } from "./data-freshness";

export function useOptionVolumeProfile(product: OptionProduct, from?: number, to?: number, enabled = true) {
  return useQuery({
    queryKey: ["option-volume-profile", product, from ? cmeTradingDayKey(from * 1000) : "pending"],
    queryFn: ({ signal }) => getOptionVolumeProfile(product, from!, to!, signal),
    enabled: enabled && !!from && !!to && to > from,
    staleTime: scopeStaleTimeMs("0dte"),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
