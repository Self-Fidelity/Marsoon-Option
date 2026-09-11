"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import type { OptionProduct, OptionScope } from "@/api/options";
import { buildDashboardViewModel } from "./dashboard-view-model";
import { useSnapshotSync } from "./data-freshness";
import { buildLevelsViewModel } from "./levels-view-model";
import { DashboardContent } from "./components/dashboard-panels";
import {
  DashboardToolbar,
  ErrorDashboard,
  LoadingDashboard,
} from "./components/dashboard-ui";
import { useOptionsDashboard } from "./use-options-dashboard";
import { useOptionsLevels } from "./use-options-levels";

const products = new Set<OptionProduct>(["NQ", "ES", "GC"]);
const scopes = new Set<OptionScope>(["close", "0dte", "d30", "d90"]);
/** 多选固定优先级（与 board-window-store 的 LINE_SCOPE_ORDER 同语义） */
const SCOPE_ORDER: OptionScope[] = ["0dte", "d30", "d90", "close"];

function parseProduct(value: string | null): OptionProduct {
  const candidate = value?.toUpperCase() as OptionProduct | undefined;
  return candidate && products.has(candidate) ? candidate : "NQ";
}

/** URL ?scope= 支持逗号多值，解析后按固定优先级排序（[0] 为主周期） */
function parseScopes(value: string | null): OptionScope[] {
  const list = (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .map((item) => (item === "all" ? "d90" : item) as OptionScope)
    .filter((item) => scopes.has(item));
  const unique = [...new Set(list)];
  if (unique.length === 0) return ["0dte"];
  return unique.sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b));
}

export function OptionsDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const product = parseProduct(searchParams.get("product"));
  const selectedScopes = parseScopes(searchParams.get("scope"));
  // 单值消费（查询/建模）用主周期 = 多选中最高优先级
  const scope = selectedScopes[0] ?? "0dte";
  // 数据版本变化驱动失效，同一版本不重复请求
  useSnapshotSync();
  const dashboardQuery = useOptionsDashboard(product, scope);
  const levelsQuery = useOptionsLevels(product, scope);
  // 收盘档：是否有数据由 Go 裁决（BFF 已放行直连），只在数据明确为空时走空态
  const closePending = scope === "close" && dashboardQuery.data?.has_data === false;
  const viewModel = useMemo(
    () =>
      dashboardQuery.data && !closePending
        ? buildDashboardViewModel(dashboardQuery.data, scope)
        : undefined,
    [dashboardQuery.data, scope, closePending],
  );
  const levelsViewModel = useMemo(
    () => (levelsQuery.data ? buildLevelsViewModel(levelsQuery.data) : undefined),
    [levelsQuery.data],
  );

  const updateQuery = useCallback(
    (key: "product" | "scope", value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <>
      <DashboardToolbar
        product={product}
        viewModel={viewModel}
        onProductChange={(nextProduct) => updateQuery("product", nextProduct)}
      />

      <div className="dashboard-grid min-h-[calc(100vh-56px)] p-3 sm:p-4">
        {dashboardQuery.isPending ? <LoadingDashboard /> : null}
        {dashboardQuery.isError ? (
          <ErrorDashboard
            error={
              dashboardQuery.error instanceof Error
                ? dashboardQuery.error
                : new Error("未知错误")
            }
            onRetry={() => void dashboardQuery.refetch()}
          />
        ) : null}
        {closePending && !dashboardQuery.isPending && !dashboardQuery.isError ? (
          <section className="ms-panel grid min-h-[420px] place-items-center px-6 text-center">
            <div>
              <p className="text-sm text-[var(--ms-text-secondary)]">
                收盘数据待接入
              </p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.1em] text-[var(--ms-text-tertiary)]">
                每日一次结算真值 · 全天冻结 · 不展示模拟数据
              </p>
            </div>
          </section>
        ) : null}
        {viewModel && !dashboardQuery.isError ? (
          <DashboardContent
            viewModel={viewModel}
            levelsViewModel={levelsViewModel}
            levelsLoading={levelsQuery.isPending}
            levelsError={levelsQuery.isError}
          />
        ) : null}
      </div>
    </>
  );
}
