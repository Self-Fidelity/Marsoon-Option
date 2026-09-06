"use client";

import type { ReactNode } from "react";
import { productName } from "@/lib/instrument-labels";

import { optionProductConfig, type OptionProduct, type OptionScope } from "@/api/options";

import {
  effectiveLineScopes,
  effectiveTableScope,
  useBoardWindowStore,
} from "./board-window-store";

const SCOPE_CHIPS: Array<{ value: OptionScope; label: string; title: string }> = [
  { value: "close", label: "前日EOD", title: "前一 CME 交易日官方结算价与持仓量计算的固定期权结构" },
  { value: "0dte", label: "0DTE", title: "当日到期期权，数据以实际更新时间为准" },
  { value: "d30", label: "30DTE", title: "DTE ≤ 30 聚合（包含当日到期）" },
  { value: "d90", label: "90DTE", title: "DTE ≤ 90 聚合（包含当日到期与 30DTE）" },
];

export type WindowToolbarKind = "line" | "table" | "chain";

/**
 * 窗口品种选择只修改本窗；顶部品种选择统一修改所有窗口。
 * 不再提供联动按钮。周期 chips 保留既有单选与存档周期联动口径；chain 不渲染。
 */
export function WindowToolbar({
  panelId,
  kind,
  showScopes = true,
  trailing,
}: {
  panelId: string;
  kind: WindowToolbarKind;
  showScopes?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      data-panel-id={panelId}
      className="sticky top-0 z-20 flex min-h-10 flex-wrap items-center gap-1.5 border-b border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-2.5 py-1.5"
    >
      <WindowToolbarControls panelId={panelId} kind={kind} showScopes={showScopes} />
      {trailing ? <div className="ml-auto flex items-center">{trailing}</div> : null}
    </div>
  );
}

/**
 * 窗口工具行控件本体（无 sticky/border 外壳）：
 * 供 06 日内窗与图表工具控件合并为单行，其余窗口仍用 WindowToolbar。
 */
export function WindowToolbarControls({
  panelId,
  kind,
  showScopes = true,
}: {
  panelId: string;
  kind: WindowToolbarKind;
  showScopes?: boolean;
}) {
  const config = useBoardWindowStore((s) => s.windows[panelId]);
  const perProductScope = useBoardWindowStore((s) => s.perProductScope);
  const setWindowProduct = useBoardWindowStore((s) => s.setWindowProduct);
  const setWindowScope = useBoardWindowStore((s) => s.setWindowScope);
  const toggleLineScope = useBoardWindowStore((s) => s.toggleLineScope);

  if (!config) return null;
  const tableScope = effectiveTableScope(config, perProductScope);
  const lineScopes = effectiveLineScopes(config, perProductScope);

  return (
    <>
      <select
        value={config.product}
        onChange={(event) => setWindowProduct(panelId, event.target.value as OptionProduct)}
        aria-label="窗口品种"
        title="切换品种，仅影响本窗口"
        className="ms-control h-7 px-2 text-[11px] font-bold text-[var(--ms-text-primary)] outline-none focus:border-[var(--ms-brand)]"
      >
        {(Object.keys(optionProductConfig) as OptionProduct[]).map((item) => (
          <option key={item} value={item}>
            {productName(item)}
          </option>
        ))}
      </select>

      {kind === "chain" || !showScopes ? null : (
        <div className="ms-control flex p-0.5" aria-label="期权周期">
          {SCOPE_CHIPS.map((chip) => {
            const active =
              kind === "line" ? lineScopes.includes(chip.value) : tableScope === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  kind === "line" ? toggleLineScope(panelId, chip.value) : setWindowScope(panelId, chip.value)
                }
                title={chip.title}
                className={`h-[18px] px-1 font-mono text-[10px] transition-colors ${
                  active
                    ? "rounded-md bg-[var(--ms-brand-dim)] text-[var(--ms-brand)]"
                    : "text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
