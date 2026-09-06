import { useEffect, useReducer, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

import type { OptionStatsMetric } from "@/api/options";
import { OPTION_STATS_METRICS, optionStatsRatio, type OptionStatsCell, type OptionStatsModel } from "./option-stats-model";
import { useMeasureSize } from "./use-measure-size";

function compact(value: number) {
  const absolute = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const scaled = absolute >= 1e9 ? `${(absolute / 1e9).toFixed(1)}B` : absolute >= 1e6 ? `${(absolute / 1e6).toFixed(1)}M` : absolute >= 1e3 ? `${(absolute / 1e3).toFixed(1)}K` : absolute.toFixed(0);
  return `${sign}${scaled}`;
}

function valueOf(point: OptionStatsCell | undefined, metric: OptionStatsMetric) { return point?.[metric]; }
function changeOf(point: OptionStatsCell, metric: OptionStatsMetric) { return metric === "netGex" ? point.gexChange : metric === "netDex" ? point.dexChange : point.chexChange; }
function keyStrikeOf(point: OptionStatsCell, metric: OptionStatsMetric) { return metric === "netGex" ? point.keyGammaStrike : metric === "netDex" ? point.keyDeltaStrike : point.keyCharmStrike; }
const statsClock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Rust Bar Statistics style matrix in a dedicated DOM pane, synchronized to the chart time scale. */
export function OptionStatsPane({
  chart,
  model,
  metrics,
  visible,
  legend,
}: {
  chart: IChartApi | null;
  model: OptionStatsModel;
  metrics: OptionStatsMetric[];
  visible: boolean;
  legend: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [measureRef, size] = useMeasureSize<HTMLDivElement>();
  const [revision, redraw] = useReducer((value) => value + 1, 0);
  const [hover, setHover] = useState<{ unix: number; x: number } | null>(null);

  useEffect(() => {
    if (!chart) return;
    const handler = () => redraw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [chart]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas || !chart || size.width <= 0 || size.height <= 0 || !metrics.length) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(size.width * ratio));
    canvas.height = Math.max(1, Math.floor(size.height * ratio));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const colors = {
      background: color("--ms-stats-bg"),
      palettes: {
        netGex: { neutral: color("--ms-stats-gex-neutral"), positive: color("--ms-stats-gex-positive"), negative: color("--ms-stats-gex-negative") },
        netDex: { neutral: color("--ms-stats-dex-neutral"), positive: color("--ms-stats-dex-positive"), negative: color("--ms-stats-dex-negative") },
        netChex: { neutral: color("--ms-stats-chex-neutral"), positive: color("--ms-stats-chex-positive"), negative: color("--ms-stats-chex-negative") },
      },
      grid: color("--ms-stats-grid"),
      labelBackground: color("--ms-stats-label-bg"),
      text: color("--ms-stats-text"),
      font: color("--ms-font-data"),
    };
    context.fillStyle = colors.background;
    context.fillRect(0, 0, size.width, size.height);

    const timeScale = chart.timeScale();
    const rowHeight = size.height / metrics.length;
    const labelWidth = Math.min(72, size.width * .24);
    const plotRight = size.width - labelWidth;
    const cellWidth = Math.max(1, Math.min(80, (timeScale.options().barSpacing ?? 6) * .9));
    const visibleBars = model.barTimes.flatMap((unix) => {
      const x = timeScale.timeToCoordinate(unix as UTCTimestamp);
      return x === null || x < -cellWidth || x > plotRight + cellWidth ? [] : [{ unix, x }];
    });
    context.font = `600 10px ${colors.font || "monospace"}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let row = 0; row < metrics.length; row++) {
      const metric = metrics[row]!;
      const top = row * rowHeight;
      const centerY = top + rowHeight / 2;
      const palette = colors.palettes[metric];
      context.globalAlpha = 1;
      context.fillStyle = colors.grid;
      context.fillRect(0, Math.round(top), size.width, 1);
      for (const { unix, x } of visibleBars) {
        const value = valueOf(model.points.get(unix), metric);
        const cellLeft = x - cellWidth / 2 + 1;
        const cellPaintWidth = Math.max(1, cellWidth - 2);
        context.globalAlpha = 1;
        context.fillStyle = palette.neutral;
        context.fillRect(cellLeft, top + 2, cellPaintWidth, Math.max(1, rowHeight - 4));
        if (typeof value === "number") {
          const balance = optionStatsRatio(model.points.get(unix), metric);
          const intensity = typeof balance === "number" ? Math.pow(Math.abs(balance), 1.8) : 0;
          context.globalAlpha = value === 0 ? 1 : .12 + intensity * .88;
          context.fillStyle = value > 0 ? palette.positive : value < 0 ? palette.negative : palette.neutral;
          context.fillRect(cellLeft, top + 2, cellPaintWidth, Math.max(1, rowHeight - 4));
        }
        if (cellWidth > 30) {
          context.globalAlpha = 1;
          context.fillStyle = colors.text;
          context.fillText(typeof value === "number" ? compact(value) : "—", x, centerY);
        }
        if (hover?.unix === unix) {
          context.globalAlpha = 1;
          context.strokeStyle = colors.text;
          context.lineWidth = 1;
          context.strokeRect(cellLeft + .5, top + 2.5, Math.max(0, cellPaintWidth - 1), Math.max(0, rowHeight - 5));
        }
      }
      const label = OPTION_STATS_METRICS.find((item) => item.key === metric)?.label ?? metric;
      context.globalAlpha = 1;
      context.fillStyle = colors.labelBackground;
      context.fillRect(plotRight, top + 1, labelWidth, Math.max(1, rowHeight - 2));
      context.fillStyle = palette.positive;
      context.fillRect(plotRight + 1, top + 3, 2, Math.max(1, rowHeight - 6));
      context.fillStyle = colors.text;
      context.textAlign = "right";
      context.fillText(label, size.width - 8, centerY);
      context.textAlign = "center";
    }
    context.fillStyle = colors.grid;
    context.fillRect(plotRight, 0, 1, size.height);
  }, [chart, hover, metrics, model, revision, size, visible]);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!chart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    let nearest: { unix: number; distance: number } | undefined;
    for (const unix of model.barTimes) {
      if (!model.points.has(unix)) continue;
      const coordinate = chart.timeScale().timeToCoordinate(unix as UTCTimestamp);
      if (coordinate === null) continue;
      const distance = Math.abs(coordinate - x);
      if (!nearest || distance < nearest.distance) nearest = { unix, distance };
    }
    setHover(nearest && nearest.distance <= Math.max(18, (chart.timeScale().options().barSpacing ?? 6) * .7) ? { unix: nearest.unix, x } : null);
  };
  const hoverPoint = hover ? model.points.get(hover.unix) : undefined;
  const tooltipLeft = Math.max(4, Math.min(size.width - 244, (hover?.x ?? 0) - 120));

  return <div ref={measureRef} onPointerMove={visible ? onPointerMove : undefined} onPointerLeave={() => setHover(null)} className={`${visible ? "h-[clamp(84px,24%,160px)]" : "h-9"} relative shrink-0 border-t border-[var(--ms-stats-grid)] bg-[var(--ms-stats-bg)] transition-[height]`} data-option-stats-canvas={visible ? "1" : "0"}>
    {visible ? <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0" /> : null}
    <div className="absolute left-2 top-1 z-40">{legend}</div>
    {hoverPoint ? <div className="ms-popover pointer-events-none absolute bottom-full z-50 mb-1 w-[240px] p-2 font-mono text-[9px] leading-4 text-[var(--ms-text-primary)]" style={{ left: tooltipLeft }}>
      <div className="mb-1 text-[var(--ms-brand)]">{statsClock.format(new Date(hoverPoint.unix * 1000))} CT · 较上一根</div>
      {metrics.map((metric) => {
        const item = OPTION_STATS_METRICS.find((entry) => entry.key === metric)!;
        const change = changeOf(hoverPoint, metric);
        const strike = keyStrikeOf(hoverPoint, metric);
        return <div key={metric} className="flex justify-between gap-3"><span className="text-[var(--ms-text-secondary)]">Δ {item.label}</span><span>{typeof change === "number" ? compact(change) : "—"} · 主导价 {typeof strike === "number" ? strike.toLocaleString("en-US") : "—"}</span></div>;
      })}
    </div> : null}
  </div>;
}
