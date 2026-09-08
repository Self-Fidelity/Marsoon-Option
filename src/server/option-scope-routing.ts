import type { OptionScope } from "@/api/options";

/** The unified backend implements every public scope; never collapse d30/d90 into all. */
export function backendOptionScope(scope: OptionScope): OptionScope {
  return scope;
}

export function defaultDashboardDays(scope: OptionScope): number {
  if (scope === "d90") return 90;
  if (scope === "d30") return 30;
  if (scope === "0dte") return 1;
  return 45;
}
