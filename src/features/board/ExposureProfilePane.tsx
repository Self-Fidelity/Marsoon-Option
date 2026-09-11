"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  formatInteger,
  formatNotional,
  formatPrice,
} from "@/lib/formatters";

import { adaptiveLabelIndices } from "./axis-label-density";
import type { ExposureProfileBar, ExposureProfileModel } from "./exposure-profile-model";
import { profileP95 } from "./gex-breakdown-model";
import {
  clampStrikeViewport,
  defaultStrikeViewport,
  panStrikeViewport,
  zoomStrikeViewport,
  type StrikeViewport,
} from "./strike-viewport";
import { useMeasureSize } from "./use-measure-size";

const FALLBACK_W = 960;
const FALLBACK_H = 390;
const PAD_L = 58;
const PAD_R = 18;
const PAD_T = 24;
const PAD_B = 34;

type ExposureMode = "oi" | "gex" | "dex" | "vex" | "chex";
type ActiveExposureMode = Exclude<ExposureMode, "vex">;
type OverlayKey = "spot" | "flip" | "key" | "walls";

const MODES: Array<{ key: ExposureMode; label: string; disabled?: boolean; title: string }> = [
  { key: "oi", label: "OI", title: "Call OI 向上、Put OI 向下" },
  { key: "gex", label: "GEX", title: "Call GEX 向上、Put GEX 向下" },
  { key: "dex", label: "DEX", title: "同执行价净 Delta Exposure" },
  { key: "vex", label: "VEX", disabled: true, title: "当前接口未提供 Vega Exposure" },
  { key: "chex", label: "CHEX", title: "同执行价净 Charm Exposure" },
];

const MODE_NAMES: Record<ActiveExposureMode, string> = {
  oi: "OI",
  gex: "GEX",
  dex: "DEX",
  chex: "CHEX",
};

interface ExposurePoint {
  row: ExposureProfileBar;
  positive: number;
  negative: number;
  available: boolean;
}

interface ReferenceLine {
  key: string;
  label: string;
  value?: number;
  color: string;
  dash?: string;
}

function exposurePoint(row: ExposureProfileBar, mode: ActiveExposureMode): ExposurePoint {
  if (mode === "oi") {
    return {
      row,
      positive: row.callOI ?? 0,
      negative: -(row.putOI ?? 0),
      available: row.callOI !== undefined || row.putOI !== undefined,
    };
  }
  if (mode === "gex") {
    return {
      row,
      positive: Math.max(0, row.callGex) + Math.max(0, row.putGex),
      negative: Math.min(0, row.callGex) + Math.min(0, row.putGex),
      available: Number.isFinite(row.callGex) || Number.isFinite(row.putGex),
    };
  }
  const value = mode === "dex" ? row.netDelta : row.netCharm;
  return {
    row,
    positive: Math.max(0, value ?? 0),
    negative: Math.min(0, value ?? 0),
    available: value !== undefined && Number.isFinite(value),
  };
}

function metricValue(value: number, mode: ActiveExposureMode): string {
  return mode === "oi" ? formatInteger(value) : formatNotional(value);
}

function ToggleChip({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onClick}
      className={`ms-control flex h-7 items-center gap-1.5 px-2 text-[10px] transition-colors ${
        checked ? "border-[var(--ms-brand)] text-[var(--ms-text-primary)]" : "text-[var(--ms-text-secondary)]"
      }`}
    >
      <span
        aria-hidden="true"
        className="grid size-3 place-items-center border text-[9px] leading-none"
        style={{
          borderColor: checked ? "var(--ms-brand)" : "var(--ms-axis)",
          background: checked ? "var(--ms-brand)" : "transparent",
          color: "var(--ms-plot-bg)",
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

function strikeStep(strikes: number[], tickSize: number): number {
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < strikes.length; index++) {
    const delta = strikes[index]! - strikes[index - 1]!;
    if (delta > 0 && delta < step) step = delta;
  }
  return Number.isFinite(step) ? step : Math.max(tickSize, 1);
}

function pointerStrike(
  clientX: number,
  rect: DOMRect,
  plotLeft: number,
  plotRight: number,
  viewport: StrikeViewport,
): number {
  const localX = Math.max(plotLeft, Math.min(plotRight, clientX - rect.left));
  const span = Math.max(1e-9, viewport.hi - viewport.lo);
  return viewport.lo + ((localX - plotLeft) / Math.max(1, plotRight - plotLeft)) * span;
}

/** 全执行价 Exposure 剖面：同一张图切换 OI/GEX/DEX/CHEX；可拖拽平移、滚轮缩放。 */
function ExposureProfileChart({ model }: { model: ExposureProfileModel }) {
  const [mode, setMode] = useState<ActiveExposureMode>("oi");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    spot: true,
    flip: true,
    key: true,
    walls: true,
  });
  const [hoverStrike, setHoverStrike] = useState<number | null>(null);
  const [viewport, setViewport] = useState<StrikeViewport | null>(null);
  const [dragging, setDragging] = useState(false);
  const [measureRef, measured] = useMeasureSize<HTMLDivElement>();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; origin: StrikeViewport } | null>(null);
  const viewRef = useRef<StrikeViewport>({ lo: 0, hi: 1 });
  const fullRef = useRef<StrikeViewport>({ lo: 0, hi: 1 });
  const plotRef = useRef({ left: PAD_L, right: PAD_L + 80, minSpan: 1 });
  const reactId = useId();
  const clipId = `exposure-plot-${reactId.replace(/:/g, "")}`;

  const setChartRef = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node;
      measureRef(node);
    },
    [measureRef],
  );

  const width = measured.width > 0 ? measured.width : FALLBACK_W;
  const height = measured.height > 0 ? measured.height : FALLBACK_H;
  const plotLeft = PAD_L;
  const plotRight = Math.max(PAD_L + 80, width - PAD_R);
  const plotTop = PAD_T;
  const plotBottom = Math.max(PAD_T + 80, height - PAD_B);
  const zeroY = (plotTop + plotBottom) / 2;
  const halfHeight = Math.max(20, (plotBottom - plotTop) / 2 - 8);

  const points = useMemo(
    () => model.profile.map((row) => exposurePoint(row, mode)),
    [model.profile, mode],
  );
  const available = points.filter((point) => point.available);
  const strikeLo = model.profile[0]?.strike ?? 0;
  const strikeHi = model.profile.at(-1)?.strike ?? strikeLo + model.tickSize;
  const full = useMemo<StrikeViewport>(
    () => ({ lo: strikeLo, hi: Math.max(strikeHi, strikeLo + model.tickSize) }),
    [strikeLo, strikeHi, model.tickSize],
  );
  const step = useMemo(
    () => strikeStep(model.profile.map((row) => row.strike), model.tickSize),
    [model.profile, model.tickSize],
  );
  const minSpan = Math.max(step * 6, model.tickSize * 8);
  const preferred = defaultStrikeViewport(full, model.spot, step, minSpan);
  const view = clampStrikeViewport(viewport ?? preferred, full, minSpan);
  const viewSpan = Math.max(minSpan, view.hi - view.lo);
  const zoomed = Math.abs(view.lo - preferred.lo) > 1e-6 || Math.abs(view.hi - preferred.hi) > 1e-6;
  viewRef.current = view;
  fullRef.current = full;
  plotRef.current = { left: plotLeft, right: plotRight, minSpan };

  const xOf = (strike: number) =>
    plotLeft + ((strike - view.lo) / viewSpan) * (plotRight - plotLeft);
  const visible = points.filter(
    (point) => point.row.strike >= view.lo - step && point.row.strike <= view.hi + step,
  );
  const scale = profileP95(
    (visible.length ? visible : available).flatMap((point) => [
      Math.abs(point.positive),
      Math.abs(point.negative),
    ]),
  );
  const yOf = (value: number) => zeroY - Math.max(-1, Math.min(1, value / scale)) * halfHeight;
  const slot = ((step / viewSpan) * (plotRight - plotLeft)) || ((plotRight - plotLeft) / Math.max(1, visible.length));
  const barWidth = Math.max(1, Math.min(18, slot * 0.68));
  const splitBars = mode === "oi" || mode === "gex";

  let cumulative = 0;
  const totalMagnitude = available.reduce(
    (sum, point) => sum + Math.abs(point.positive) + Math.abs(point.negative),
    0,
  );
  const cumulativePath = points
    .map((point, index) => {
      cumulative += point.available ? Math.abs(point.positive) + Math.abs(point.negative) : 0;
      const x = xOf(point.row.strike);
      const y = plotBottom - (totalMagnitude > 0 ? cumulative / totalMagnitude : 0) * (plotBottom - plotTop);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const visibleTicks = points.filter(
    (point) => point.row.strike >= view.lo && point.row.strike <= view.hi,
  );
  const tickIndexes = adaptiveLabelIndices(visibleTicks.length, plotRight - plotLeft, 88);
  const hovered = hoverStrike === null
    ? undefined
    : points.reduce<ExposurePoint | undefined>(
        (best, point) =>
          !best || Math.abs(point.row.strike - hoverStrike) < Math.abs(best.row.strike - hoverStrike)
            ? point
            : best,
        undefined,
      );

  const references: ReferenceLine[] = [];
  if (overlays.spot) references.push({ key: "spot", label: "SPOT", value: model.spot, color: "var(--ms-key-gamma)" });
  if (overlays.flip) references.push({ key: "flip", label: "GAMMA FLIP", value: model.gammaFlip, color: "var(--ms-brand)", dash: "5 4" });
  if (overlays.key) references.push({ key: "key", label: "KEY Γ", value: model.keyGammaStrike, color: "var(--ms-text-primary)", dash: "3 3" });
  if (overlays.walls) {
    references.push({ key: "cw", label: "CALL WALL", value: model.callWall, color: "var(--ms-success)", dash: "4 3" });
    references.push({ key: "pw", label: "PUT WALL", value: model.putWall, color: "var(--ms-danger)", dash: "4 3" });
  }

  const hoverDetail = hovered
    ? mode === "oi"
      ? `Call ${formatInteger(hovered.row.callOI)} · Put ${formatInteger(hovered.row.putOI)}`
      : mode === "gex"
        ? `Call ${formatNotional(hovered.row.callGex)} · Put ${formatNotional(hovered.row.putGex)}`
        : `Net ${metricValue(hovered.positive + hovered.negative, mode)}`
    : "";

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = node.getBoundingClientRect();
      const plot = plotRef.current;
      const current = viewRef.current;
      const anchor = pointerStrike(event.clientX, rect, plot.left, plot.right, current);
      setViewport(zoomStrikeViewport(current, fullRef.current, anchor, event.deltaY, plot.minSpan));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [available.length]);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, origin: view };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      const fraction = -(event.clientX - drag.startX) / Math.max(1, plotRight - plotLeft);
      setViewport(panStrikeViewport(drag.origin, full, fraction, minSpan));
      return;
    }
    setHoverStrike(pointerStrike(event.clientX, rect, plotLeft, plotRight, view));
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const axisTop =
    mode === "oi" ? `+${formatInteger(scale)}` : metricValue(scale, mode);
  const axisBottom =
    mode === "oi" ? `−${formatInteger(scale)}` : metricValue(-scale, mode);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-2 py-1.5">
        <div className="ms-control flex overflow-hidden p-0" aria-label="Exposure 指标">
          {MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              title={item.title}
              aria-pressed={item.key === mode}
              onClick={() => !item.disabled && setMode(item.key as ActiveExposureMode)}
              className={`h-7 border-r border-[var(--ms-separator)] px-2.5 font-mono text-[10px] font-semibold transition-colors last:border-r-0 ${
                item.key === mode
                  ? "bg-[var(--ms-brand)] text-[var(--ms-plot-bg)]"
                  : item.disabled
                    ? "cursor-not-allowed text-[var(--ms-text-tertiary)] opacity-45"
                    : "text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ToggleChip checked={overlays.spot} label="现价" onClick={() => setOverlays((old) => ({ ...old, spot: !old.spot }))} />
        <ToggleChip checked={overlays.flip} label="零 Gamma" onClick={() => setOverlays((old) => ({ ...old, flip: !old.flip }))} />
        <ToggleChip checked={overlays.key} label="主要价位" onClick={() => setOverlays((old) => ({ ...old, key: !old.key }))} />
        <ToggleChip checked={overlays.walls} label="看涨 / 看跌墙" onClick={() => setOverlays((old) => ({ ...old, walls: !old.walls }))} />
        {zoomed ? (
          <button
            type="button"
            className="ms-control h-7 px-2 font-mono text-[10px] text-[var(--ms-text-secondary)]"
            onClick={() => setViewport(null)}
          >
            复位
          </button>
        ) : null}
      </div>

      <div
        ref={setChartRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[var(--ms-plot-bg)]"
        style={{ touchAction: "none" }}
      >
        {available.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-[var(--ms-text-secondary)]">
            当前快照没有可用的 {MODE_NAMES[mode]} 执行价数据
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className={`absolute left-0 top-0 select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            role="img"
            aria-label={`${MODE_NAMES[mode]} 全执行价剖面，可拖拽平移、滚轮缩放`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onPointerLeave={() => {
              if (!dragRef.current) setHoverStrike(null);
            }}
            onDoubleClick={() => setViewport(null)}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop} />
              </clipPath>
            </defs>
            <line x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} stroke="var(--ms-axis)" strokeWidth={1} opacity={0.75} />

            <g clipPath={`url(#${clipId})`}>
              {visible.map((point) => {
                if (!point.available) return null;
                const x = xOf(point.row.strike);
                const positiveY = yOf(point.positive);
                const negativeY = yOf(point.negative);
                const half = splitBars ? Math.max(0.5, barWidth / 2) : barWidth;
                return (
                  <g key={point.row.strike}>
                    {point.positive > 0 ? (
                      <rect
                        x={x - (splitBars ? half : barWidth / 2)}
                        y={positiveY}
                        width={half}
                        height={Math.max(1, zeroY - positiveY)}
                        fill="var(--ms-chart-buy)"
                      />
                    ) : null}
                    {point.negative < 0 ? (
                      <rect
                        x={x + (splitBars ? 0 : -barWidth / 2)}
                        y={zeroY}
                        width={half}
                        height={Math.max(1, negativeY - zeroY)}
                        fill="var(--ms-chart-sell)"
                      />
                    ) : null}
                  </g>
                );
              })}

              {cumulativePath ? <path d={cumulativePath} fill="none" stroke="var(--ms-text-primary)" strokeWidth={1.5} opacity={0.8} /> : null}

              {references.map((reference) => {
                if (reference.value === undefined) return null;
                const x = xOf(reference.value);
                if (x < plotLeft - 1 || x > plotRight + 1) return null;
                return (
                  <line
                    key={reference.key}
                    x1={x}
                    x2={x}
                    y1={plotTop}
                    y2={plotBottom}
                    stroke={reference.color}
                    strokeWidth={1.5}
                    strokeDasharray={reference.dash}
                  />
                );
              })}

              {hovered ? (
                <line
                  x1={xOf(hovered.row.strike)}
                  x2={xOf(hovered.row.strike)}
                  y1={plotTop}
                  y2={plotBottom}
                  stroke="var(--ms-text-secondary)"
                  strokeDasharray="3 3"
                />
              ) : null}
            </g>

            {references.map((reference, index) => {
              if (reference.value === undefined) return null;
              const x = xOf(reference.value);
              if (x < plotLeft - 1 || x > plotRight + 1) return null;
              return (
                <text
                  key={`${reference.key}-label`}
                  x={Math.min(plotRight - 4, Math.max(plotLeft + 4, x + 4))}
                  y={plotTop + 11 + index * 13}
                  fontSize={9}
                  fontWeight={600}
                  fill={reference.color}
                  className="font-mono"
                >
                  {reference.label} {formatPrice(reference.value, model.tickSize)}
                </text>
              );
            })}

            {hovered && !dragging ? (
              <g pointerEvents="none">
                <rect
                  x={Math.max(plotLeft, Math.min(plotRight - 214, xOf(hovered.row.strike) + 8))}
                  y={plotTop + 4}
                  width={206}
                  height={42}
                  fill="var(--ms-card-bg)"
                  stroke="var(--ms-separator)"
                />
                <text x={Math.max(plotLeft + 8, Math.min(plotRight - 206, xOf(hovered.row.strike) + 16))} y={plotTop + 19} fontSize={10} fill="var(--ms-text-primary)" className="font-mono">
                  K {formatPrice(hovered.row.strike, model.tickSize)} · {MODE_NAMES[mode]}
                </text>
                <text x={Math.max(plotLeft + 8, Math.min(plotRight - 206, xOf(hovered.row.strike) + 16))} y={plotTop + 34} fontSize={9} fill="var(--ms-text-secondary)" className="font-mono">
                  {hoverDetail}
                </text>
              </g>
            ) : null}

            <text x={6} y={plotTop + 8} fontSize={9} fill="var(--ms-text-secondary)" className="font-mono">{axisTop}</text>
            <text x={6} y={zeroY + 3} fontSize={9} fill="var(--ms-text-tertiary)" className="font-mono">0</text>
            <text x={6} y={plotBottom} fontSize={9} fill="var(--ms-text-secondary)" className="font-mono">{axisBottom}</text>

            {tickIndexes.map((index) => {
              const point = visibleTicks[index];
              if (!point) return null;
              const x = xOf(point.row.strike);
              return (
                <g key={`${point.row.strike}-${index}`}>
                  <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + 4} stroke="var(--ms-axis)" />
                  <text x={x} y={height - 10} textAnchor="middle" fontSize={9} fill="var(--ms-text-secondary)" className="font-mono">
                    {formatPrice(point.row.strike, model.tickSize)}
                  </text>
                </g>
              );
            })}

            <g transform={`translate(${Math.max(plotLeft, width / 2 - 80)}, 15)`} pointerEvents="none">
              <line x1={0} x2={20} y1={0} y2={0} stroke="var(--ms-text-primary)" strokeWidth={1.5} />
              <text x={25} y={3} fontSize={9} fill="var(--ms-text-secondary)" className="font-mono">累计绝对值</text>
              <rect x={92} y={-5} width={12} height={10} fill="var(--ms-chart-buy)" />
              <rect x={104} y={-5} width={12} height={10} fill="var(--ms-chart-sell)" />
              <text x={121} y={3} fontSize={9} fill="var(--ms-text-secondary)" className="font-mono">柱状</text>
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

/** 06 底部副图：全执行价 Exposure 剖面（OI/GEX/DEX/CHEX），由 06 容器给边框分隔与高度。 */
export function ExposureProfilePane({ model }: { model?: ExposureProfileModel }) {
  if (!model || model.profile.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">
        当前周期暂无 Exposure 数据
      </div>
    );
  }
  return <ExposureProfileChart model={model} />;
}
