"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { daysToExpiry, formatExpiry, formatInteger, formatNotional, formatPrice } from "@/lib/formatters";
import { useBoardFocusStore } from "./board-focus-store";
import { displayHeatmapValue, heatmapCellKey, type ExpirationHeatmapModel, type HeatmapCellDatum, type HeatmapExpiryMode } from "./expiration-heatmap-model";
import { nearbyStrikeWindow, virtualRowWindow } from "./expiration-heatmap-viewport";
import { useMeasureSize } from "./use-measure-size";

type Metric = "netGex" | "grossGex" | "netDelta" | "grossDelta" | "netCharm" | "grossCharm" | "oiImbalance";
const METRICS: Array<{ value: Metric; label: string }> = [
  { value: "netGex", label: "Net GEX" }, { value: "grossGex", label: "Gross GEX" },
  { value: "netDelta", label: "Net Delta" }, { value: "grossDelta", label: "Gross Delta" },
  { value: "netCharm", label: "Net Charm" }, { value: "grossCharm", label: "Gross Charm" },
  { value: "oiImbalance", label: "OI Imbalance" },
];
const ROW_H = 28;
const HEADER_H = 44;
const AXIS_W = 76;
function valueOf(cell: HeatmapCellDatum | undefined, metric: Metric) { return cell?.[metric]; }
function heat(value: number, maxAbs: number) {
  if (Math.abs(value) < 1e-9) return "var(--ms-panel-bg)";
  // P95 截顶由调用侧计算；平方根拉伸中小值，避免极端大值把其余格压成同一暗色。
  const strength = Math.sqrt(Math.min(1, Math.abs(value) / Math.max(maxAbs, 1e-9)));
  const color = value >= 0 ? "var(--ms-chart-buy)" : "var(--ms-chart-sell)";
  return `color-mix(in srgb, ${color} ${Math.round(16 + strength * 80)}%, var(--ms-panel-bg))`;
}

/** Rust 终端式到期热力图：日期列 × 行权价行、固定行高、全局色阶、关键位短标记。 */
export function ExpirationHeatmapPanel({
  model,
  expiryMode,
  onExpiryModeChange,
}: {
  model: ExpirationHeatmapModel;
  expiryMode: HeatmapExpiryMode;
  onExpiryModeChange: (mode: HeatmapExpiryMode) => void;
}) {
  const [metric, setMetric] = useState<Metric>("netGex");
  const [showNumbers, setShowNumbers] = useState(true);
  const [strikeRange, setStrikeRange] = useState<"near" | "all">("near");
  const [hover, setHover] = useState<{ expiration: number; strike: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const pendingScrollTop = useRef(0);
  const [scrollMeasureRef, scrollSize] = useMeasureSize<HTMLDivElement>();
  const setScrollHost = useCallback((node: HTMLDivElement | null) => { scrollRef.current = node; scrollMeasureRef(node); }, [scrollMeasureRef]);
  const setFocus = useBoardFocusStore((s) => s.setFocus);
  const { expirations, cells } = model;
  const strikes = useMemo(() => strikeRange === "near" ? nearbyStrikeWindow(model.strikes, model.spot) : model.strikes, [model.strikes, model.spot, strikeRange]);
  const rowWindow = virtualRowWindow(strikes.length, scrollTop, scrollSize.height || 620, ROW_H, HEADER_H);
  const renderedStrikes = strikes.slice(rowWindow.start, rowWindow.end);
  const maxAbs = useMemo(() => {
    const values: number[] = [];
    for (const strike of strikes) for (const expiration of expirations) {
      const cell = cells.get(heatmapCellKey(expiration, strike));
      const value = displayHeatmapValue(valueOf(cell, metric), cell?.qualityFlags ?? 0);
      if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 1e-9) values.push(Math.abs(value));
    }
    if (!values.length) return 1e-9;
    values.sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * 0.95)]!;
  }, [cells, metric, strikes, expirations]);
  const nearest = (value: number | undefined) => value === undefined || strikes.length === 0 ? undefined : strikes.reduce((best, strike) => Math.abs(strike - value) < Math.abs(best - value) ? strike : best);
  const spotStrike = nearest(model.spot);
  const centerSpot = useCallback((behavior: ScrollBehavior) => {
    const root = scrollRef.current;
    if (!root || spotStrike === undefined) return;
    const index = strikes.indexOf(spotStrike);
    if (index < 0) return;
    root.scrollTo({
      top: Math.max(0, HEADER_H + index * ROW_H - root.clientHeight / 2 + ROW_H / 2),
      behavior,
    });
  }, [spotStrike, strikes]);

  useEffect(() => {
    centerSpot("auto");
  }, [spotStrike, strikes, centerSpot]);

  useEffect(() => () => { if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); }, []);

  if (!expirations.length || !model.strikes.length) return <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">当前快照没有 30 天内的到期 × 执行价数据</div>;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ms-plot-bg)]">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-3 py-2">
        <div className="ms-control flex p-0.5" aria-label="到期范围">
          <button type="button" aria-pressed={expiryMode === "front"} onClick={() => onExpiryModeChange("front")} className="h-6 rounded-[7px] px-2 text-[10px] font-semibold aria-pressed:bg-[var(--ms-brand)] aria-pressed:text-black">{model.frontExpirationFallback ? "最近到期" : "0DTE"}</button>
          <button type="button" aria-pressed={expiryMode === "all"} onClick={() => onExpiryModeChange("all")} className="h-6 rounded-[7px] px-2 text-[10px] font-semibold aria-pressed:bg-[var(--ms-brand)] aria-pressed:text-black">全部到期</button>
        </div>
        <div className="ms-control flex p-0.5" aria-label="执行价范围">
          <button type="button" aria-pressed={strikeRange === "near"} onClick={() => setStrikeRange("near")} className="h-6 rounded-[7px] px-2 text-[10px] font-semibold aria-pressed:bg-[var(--ms-brand-dim)] aria-pressed:text-[var(--ms-brand)]">现价附近</button>
          <button type="button" aria-pressed={strikeRange === "all"} onClick={() => setStrikeRange("all")} className="h-6 rounded-[7px] px-2 text-[10px] font-semibold aria-pressed:bg-[var(--ms-brand-dim)] aria-pressed:text-[var(--ms-brand)]">全部</button>
        </div>
        <select aria-label="热力图指标" value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="ms-control h-8 px-2.5 text-[11px] font-semibold text-[var(--ms-text-primary)]">{METRICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <button type="button" aria-pressed={showNumbers} onClick={() => setShowNumbers((v) => !v)} className="ms-control h-8 px-2.5 text-[11px] font-semibold text-[var(--ms-text-secondary)]">数值</button>
        <button type="button" disabled={spotStrike === undefined} onClick={() => centerSpot("smooth")} className="ms-control flex h-8 items-center gap-1 px-2.5 text-[11px] font-semibold text-[var(--ms-text-secondary)] hover:text-[var(--ms-brand)] disabled:opacity-40" title="滚动到距离现价最近的执行价" aria-label="回到现价"><Crosshair size={12} />回到现价</button>
      </div>

      <div ref={setScrollHost} className="min-h-0 flex-1 overflow-auto" data-total-rows={strikes.length} data-rendered-rows={renderedStrikes.length} onScroll={(event) => {
        pendingScrollTop.current = event.currentTarget.scrollTop;
        if (scrollFrame.current !== null) return;
        scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = null; setScrollTop(pendingScrollTop.current); });
      }}>
        <div className="min-w-max" style={{ width: `max(100%, ${AXIS_W + expirations.length * 84}px)` }}>
          <div className="sticky top-0 z-20 grid border-b border-[var(--ms-separator)] bg-[var(--ms-panel-bg)]" style={{ height: HEADER_H, gridTemplateColumns: `${AXIS_W}px repeat(${expirations.length}, minmax(84px, 1fr))` }}>
            <div className="sticky left-0 z-30 flex items-center justify-end border-r border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] pr-2 font-mono text-[9px] text-[var(--ms-text-tertiary)]">STRIKE</div>
            {expirations.map((expiration) => <button key={expiration} type="button" onClick={() => setFocus({ expiry: expiration })} className="h-11 border-r border-[var(--ms-separator)] font-mono text-[10px] text-[var(--ms-text-secondary)]"><span className="block">{formatExpiry(expiration)}</span><span className="text-[8px] text-[var(--ms-text-tertiary)]">{expiryMode === "front" && !model.frontExpirationFallback ? 0 : daysToExpiry(expiration, model.snapshotUnix)}DTE</span></button>)}
          </div>

          {rowWindow.top > 0 ? <div aria-hidden="true" style={{ height: rowWindow.top }} /> : null}
          {renderedStrikes.map((strike) => (
            <div key={strike} data-spot-row={strike === spotStrike || undefined} className="grid border-b border-[var(--ms-grid)]" style={{ height: ROW_H, gridTemplateColumns: `${AXIS_W}px repeat(${expirations.length}, minmax(84px, 1fr))` }}>
              <button type="button" onClick={() => setFocus({ strike })} className={`sticky left-0 z-10 border-r border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] pr-2 text-right font-mono text-[10px] tabular-nums ${strike === spotStrike ? "font-bold text-[var(--ms-key-gamma)]" : "text-[var(--ms-text-secondary)]"}`}>{formatPrice(strike, model.tickSize)}</button>
              {expirations.map((expiration) => {
                const cell = cells.get(heatmapCellKey(expiration, strike));
                const value = displayHeatmapValue(valueOf(cell, metric), cell?.qualityFlags ?? 0);
                const levels = model.expiryLevels.get(expiration);
                const marks: string[] = [];
                if (nearest(levels?.callWall) === strike) marks.push("CW");
                if (nearest(levels?.putWall) === strike) marks.push("PW");
                if (nearest(levels?.flip) === strike) marks.push("ΓF");
                const active = hover?.expiration === expiration && hover?.strike === strike;
                return <button key={expiration} type="button" onMouseEnter={() => setHover({ expiration, strike })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ expiration, strike })} onBlur={() => setHover(null)} onClick={() => setFocus({ expiry: expiration, strike })} className={`relative border-r border-[var(--ms-grid)] font-mono text-[9px] tabular-nums transition ${active ? "outline outline-1 -outline-offset-1 outline-[var(--ms-brand)]" : ""}`} style={{ background: typeof value === "number" ? heat(value, maxAbs) : "var(--ms-panel-bg)", color: "var(--ms-text-primary)" }} title={`${formatExpiry(expiration)} · ${formatPrice(strike, model.tickSize)} · ${METRICS.find((item) => item.value === metric)?.label}: ${metric === "oiImbalance" ? formatInteger(value) : formatNotional(value)}${cell?.qualityFlags ? ` · quality_flags=${cell.qualityFlags}` : ""}`}>
                  {showNumbers && typeof value === "number" ? <span>{metric === "oiImbalance" ? formatInteger(value) : formatNotional(value).replace("$", "")}</span> : null}
                  {marks.length ? <span className="absolute left-0 top-0 bg-[var(--ms-plot-bg)] px-0.5 text-[7px] text-[var(--ms-brand)]">{marks.join("·")}</span> : null}
                  {cell?.qualityFlags ? <span className="absolute right-0 top-0 h-0 w-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-[var(--ms-brand)]" aria-hidden="true" /> : null}
                </button>;
              })}
            </div>
          ))}
          {rowWindow.bottom > 0 ? <div aria-hidden="true" style={{ height: rowWindow.bottom }} /> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--ms-separator)] px-3 py-1 font-mono text-[8px] text-[var(--ms-text-tertiary)]">
        <span>−</span><span className="h-2 w-16" style={{ background: "linear-gradient(90deg,var(--ms-chart-sell),var(--ms-panel-bg),var(--ms-chart-buy))" }} /><span>+</span>
        <span>全图统一色阶 · CW / PW / ΓF 为各到期关键位</span>
        <span className="ml-auto">{strikeRange === "near" ? `现价附近 ${strikes.length} 档` : `全部 ${strikes.length} 档`}{expiryMode === "all" && model.truncatedExpirations ? ` · +${model.truncatedExpirations} 个到期未显示` : ""}</span>
      </div>
    </div>
  );
}
