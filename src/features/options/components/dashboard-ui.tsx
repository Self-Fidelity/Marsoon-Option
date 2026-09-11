import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { productName } from "@/lib/instrument-labels";
import { dataLoadFailureMessage } from "@/lib/data-messages";

import {
  optionProductConfig,
  OptionsApiError,
  type OptionProduct,
  type OptionScope,
} from "@/api/options";
import { formatPrice } from "@/lib/formatters";
import type { DashboardViewModel } from "../dashboard-view-model";

const MASTER_SCOPE_CHIPS: Array<{ value: OptionScope; label: string; title: string }> = [
  { value: "close", label: "前日EOD", title: "前一 CME 交易日官方结算价与持仓量计算的固定期权结构" },
  { value: "0dte", label: "0DTE", title: "当日到期期权，数据以实际更新时间为准" },
  { value: "d30", label: "30DTE", title: "DTE ≤ 30 聚合（包含当日到期）" },
  { value: "d90", label: "90DTE", title: "DTE ≤ 90 聚合（包含当日到期与 30DTE）" },
];

export function DashboardToolbar({
  product,
  viewModel,
  onProductChange,
  scopes,
  onToggleScope,
  leading,
  productTrailing,
  trailing,
}: {
  product: OptionProduct;
  viewModel?: DashboardViewModel;
  onProductChange: (product: OptionProduct) => void;
  /** 总控周期多选（至少 1 项，[0] 为主周期）；与 onToggleScope 同时提供才渲染 chips */
  scopes?: OptionScope[];
  onToggleScope?: (scope: OptionScope) => void;
  leading?: ReactNode;
  productTrailing?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-[200] flex h-14 items-center gap-2 border-b border-[var(--ms-separator)] bg-[var(--ms-app-bg)] px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <select
          value={product}
          onChange={(event) => onProductChange(event.target.value as OptionProduct)}
          aria-label="选择期权产品"
          className="ms-control h-9 min-w-28 px-2.5 text-[12px] font-semibold text-[var(--ms-text-primary)] outline-none focus:border-[var(--ms-brand)]"
        >
          {(Object.keys(optionProductConfig) as OptionProduct[]).map((item) => (
            <option key={item} value={item}>
              {productName(item)}
            </option>
          ))}
        </select>
        {scopes && onToggleScope ? (
          <div className="ms-control flex p-0.5" aria-label="期权周期（多选，至少保留一项）">
            {MASTER_SCOPE_CHIPS.map((chip) => {
              const active = scopes.includes(chip.value);
              return (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleScope(chip.value)}
                  title={chip.title}
                  className={`h-7 rounded-md px-2 text-[11px] font-semibold transition-colors ${
                    active
                      ? "bg-[var(--ms-brand-dim)] text-[var(--ms-brand)]"
                      : "text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {productTrailing}
        {viewModel?.spot !== undefined ? (
          <div className="font-mono text-[13px] font-bold tabular-nums text-[var(--ms-text-primary)]">
            {formatPrice(viewModel.spot, optionProductConfig[product].tickSize)}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="ml-auto flex items-center">{trailing}</div> : null}
    </header>
  );
}

export function MetricCard({
  label,
  meta,
  value,
  tone = "default",
  compact = false,
}: {
  label: string;
  meta?: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "warning";
  /** 窄面板降档（01 第三十二轮）：值字号缩小并允许换行，旧页面不传不受影响 */
  compact?: boolean;
}) {
  const toneClass = {
    default: "text-[var(--ms-text-primary)]",
    positive: "text-[var(--ms-buy)]",
    negative: "text-[var(--ms-sell)]",
    warning: "text-[var(--ms-brand)]",
  }[tone];

  return (
    <article className="border-r border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] p-3 last:border-r-0">
      <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ms-text-secondary)]">
        <span>{label}</span>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div
        className={`${compact ? "break-all text-xs" : "text-lg"} font-medium tabular-nums tracking-tight ${toneClass}`}
      >
        {value}
      </div>
    </article>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ms-panel ${className}`}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--ms-separator)] px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-xs font-medium text-[var(--ms-text-primary)]">{title}</h2>
          {subtitle ? (
            <span className="hidden truncate font-mono text-[9px] text-[var(--ms-text-secondary)] sm:inline">
              {subtitle}
            </span>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function LoadingDashboard() {
  return (
    <div className="space-y-3" aria-label="正在加载期权数据">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-[var(--ms-separator)] xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse bg-[var(--ms-card-bg)]" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(260px,.72fr)]">
        <div className="h-[470px] animate-pulse rounded-[10px] border border-[var(--ms-separator)] bg-[var(--ms-card-bg)]" />
        <div className="h-[470px] animate-pulse rounded-[10px] border border-[var(--ms-separator)] bg-[var(--ms-card-bg)]" />
      </div>
    </div>
  );
}

export function ErrorDashboard({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const status = error instanceof OptionsApiError ? error.status : undefined;
  return (
    <section className="ms-panel grid min-h-[420px] place-items-center border-[var(--ms-danger)] px-6 text-center">
      <div className="max-w-lg">
        <AlertTriangle className="mx-auto mb-4 text-[var(--ms-danger)]" size={24} strokeWidth={1.5} />
        <p className="mb-2 font-mono text-[9px] tracking-[0.18em] text-[var(--ms-danger)]">DATA UNAVAILABLE</p>
        <h2 className="text-base font-medium text-[var(--ms-text-primary)]">数据加载失败</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ms-text-secondary)]">
          {dataLoadFailureMessage(status)}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="ms-control mt-5 px-4 py-2 text-xs text-[var(--ms-text-primary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
        >
          重新请求
        </button>
      </div>
    </section>
  );
}
