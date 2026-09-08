"use client";

import type { OptionScope } from "@/api/options";
import { formatPercent, formatPrice } from "@/lib/formatters";

import type { SmilePoint, SmileSkewModel } from "./smile-skew-model";
import { adaptiveLabelIndices } from "./axis-label-density";
import { useMeasureSize } from "./use-measure-size";

/** 真自适应（面板自适应规范，同 06 第十九轮）：WIDTH/HEIGHT 写死常量废除，画布 = useMeasureSize
 * 实测容器尺寸，viewBox 与 DOM px 1:1；chrome（gutter/字号/padding）固定 px，弹性全部给绘图区。
 * 首帧未实测时用兜底尺寸，下一帧实测重渲染。 */
const FALLBACK_W = 880;
const FALLBACK_H = 320;
const PAD_L = 52;
const PAD_R = 20;
const PAD_T = 16;
const PAD_B = 34;

interface CurvePoint {
  strike: number;
  callIV?: number;
  putIV?: number;
}

/** 按缺失值分段的折线 path 序列（x 按联合执行价轴索引） */
function buildSegments(
  byStrike: Map<number, CurvePoint>,
  strikes: number[],
  pick: (point: CurvePoint) => number | undefined,
  x: (index: number) => number,
  y: (value: number) => number,
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  strikes.forEach((strike, index) => {
    const point = byStrike.get(strike);
    const value = point ? pick(point) : undefined;
    if (value === undefined) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
    );
  });
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

const SCOPE_LEGEND_LABEL: Record<OptionScope, string> = {
  close: "前日EOD",
  "0dte": "0DTE",
  d30: "30DTE",
  d90: "90DTE",
};

const SCOPE_LINE_STYLE: Record<OptionScope, { dash?: string; name: string }> = {
  "0dte": { name: "实线" },
  d30: { dash: "10 4", name: "长虚线" },
  d90: { dash: "2 4", name: "点线" },
  close: { dash: "10 3 2 3", name: "点划线" },
};

export interface SmileScopeModel {
  scope: OptionScope;
  /** null = 该 scope 空态（close 待接入 / has_data:false），静默跳过、图例灰显 */
  model: SmileSkewModel | null;
}

/**
 * 07 波动率微笑偏斜：call/put IV 双曲线 + ATM 平线 + 现货锚线。
 * 缺 IV 的执行价跳过（折线断开），不降级为 0。
 *
 * 一·五节联动模型：多 scope 叠加——各 scope 的执行价网格不同（0DTE 档距密、全期限档距疏），
 * x 轴取全体执行价**并集**排序，每 scope 的曲线按 strike 对位绘制；
 * 主 scope（首项）实线 + 全套标记（ATM 点/翼标签/端点），其余 scope 虚线 + 低透明度。
 */
export function SmileSkewPanel({ models }: { models: SmileScopeModel[] }) {
  // 实测绘图区容器尺寸；width/height 为 0 表示首帧未实测，用兜底
  const [plotRef, { width: measuredW, height: measuredH }] = useMeasureSize<HTMLDivElement>();
  const WIDTH = measuredW > 0 ? measuredW : FALLBACK_W;
  const HEIGHT = measuredH > 0 ? measuredH : FALLBACK_H;
  const segments = models.map((entry, i) => ({ ...entry, primary: i === 0 }));
  const withData = segments.filter(
    (s) => s.model !== null && s.model.points.length >= 2,
  ) as Array<SmileScopeModel & { model: SmileSkewModel; primary: boolean }>;

  if (withData.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">
        当前快照没有可用的执行价 IV 数据
      </div>
    );
  }

  const primary = (segments[0]?.model ? segments[0] : withData[0]) as SmileScopeModel & {
    model: SmileSkewModel;
  };
  const tickSize = primary.model.tickSize;

  // 联合执行价轴：全体 scope 的 strike 并集升序
  const strikes = [...new Set(withData.flatMap((s) => s.model.points.map((p) => p.strike)))].sort(
    (a, b) => a - b,
  );
  const curves = withData.map((s) => ({
    scope: s.scope,
    primary: s === primary || s.primary,
    byStrike: new Map<number, CurvePoint>(s.model.points.map((p) => [p.strike, p])),
  }));

  const ivValues = withData.flatMap((s) =>
    s.model.points.flatMap((point) =>
      [point.callIV, point.putIV].filter((v): v is number => v !== undefined),
    ),
  );
  const minIv = Math.min(...ivValues);
  const maxIv = Math.max(...ivValues);
  const pad = Math.max(0.004, (maxIv - minIv) * 0.18);
  const lo = minIv - pad;
  const hi = maxIv + pad;

  const x = (index: number) =>
    PAD_L + (index / Math.max(1, strikes.length - 1)) * (WIDTH - PAD_L - PAD_R);
  const widestStrikeLabel = Math.max(...strikes.map((strike) => formatPrice(strike, tickSize).length));
  const xLabelIndices = new Set(adaptiveLabelIndices(
    strikes.length,
    WIDTH - PAD_L - PAD_R,
    Math.max(48, widestStrikeLabel * 5.5 + 12),
  ));
  const y = (value: number) =>
    PAD_T + ((hi - value) / (hi - lo)) * (HEIGHT - PAD_T - PAD_B);
  // 现货按价格比例定位（执行价近似等距）
  const minK = strikes[0]!;
  const maxK = strikes.at(-1)!;
  const spotX =
    primary.model.spot === undefined || maxK <= minK
      ? undefined
      : PAD_L +
        Math.min(1, Math.max(0, (primary.model.spot - minK) / (maxK - minK))) *
          (WIDTH - PAD_L - PAD_R);

  // ATM 点（主 scope）：最接近现货的执行价，取两侧 IV 均值
  let atmIndex = -1;
  if (primary.model.spot !== undefined) {
    atmIndex = strikes.reduce(
      (best, strike, index) =>
        Math.abs(strike - primary.model.spot!) < Math.abs(strikes[best]! - primary.model.spot!)
          ? index
          : best,
      0,
    );
  }
  const primaryByStrike = curves.find((c) => c.primary)?.byStrike ?? curves[0]!.byStrike;
  const atmPoint = atmIndex >= 0 ? primaryByStrike.get(strikes[atmIndex]!) : undefined;
  const atmIvAtPoint =
    atmPoint?.callIV !== undefined && atmPoint?.putIV !== undefined
      ? (atmPoint.callIV + atmPoint.putIV) / 2
      : (atmPoint?.callIV ?? atmPoint?.putIV);

  const gridTicks = Array.from({ length: 4 }, (_, i) => lo + ((i + 1) / 5) * (hi - lo));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ms-plot-bg)] px-3 py-4">
      {/* 绘图区容器：flex-1 吸收全部弹性，useMeasureSize 实测（整数 floor，第二十八轮 1A）；
          svg 显式整数宽高 + viewBox 同值 1:1 无缩放，父级 overflow-hidden 兜底 */}
      <div ref={plotRef} className="relative min-h-0 flex-1">
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="absolute left-0 top-0 block"
        role="img"
        aria-label="波动率微笑偏斜"
        data-x-label-count={xLabelIndices.size}
      >
        {/* 横向网格 + IV 标签 */}
        {gridTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_L} y1={y(tick)} x2={WIDTH - PAD_R} y2={y(tick)}
              stroke="var(--ms-grid)" strokeWidth={1}
            />
            <text
              x={PAD_L - 6} y={y(tick) + 3} textAnchor="end"
              fontSize={9} fill="var(--ms-text-tertiary)" fontFamily="monospace"
            >
              {formatPercent(tick)}
            </text>
          </g>
        ))}

        {/* ATM 平线（理论单一 σ 参考，主 scope） */}
        {primary.model.atmIV !== undefined && primary.model.atmIV > lo && primary.model.atmIV < hi ? (
          <g>
            <line
              x1={PAD_L} y1={y(primary.model.atmIV)} x2={WIDTH - PAD_R} y2={y(primary.model.atmIV)}
              stroke="var(--ms-text-tertiary)" strokeWidth={1} strokeDasharray="6 5" opacity={0.7}
            />
            <text
              x={WIDTH - PAD_R} y={y(primary.model.atmIV) - 4} textAnchor="end"
              fontSize={9} fill="var(--ms-text-tertiary)" fontFamily="monospace" letterSpacing={1}
            >
              ATM {formatPercent(primary.model.atmIV)}
            </text>
          </g>
        ) : null}

        {/* 现货竖虚线 */}
        {spotX !== undefined ? (
          <g>
            <line
              x1={spotX} y1={PAD_T} x2={spotX} y2={HEIGHT - PAD_B}
              stroke="var(--ms-key-gamma)" strokeWidth={1} strokeDasharray="5 4" opacity={0.8}
            />
            <text
              x={spotX} y={PAD_T + 10} textAnchor="middle"
              fontSize={9} fill="var(--ms-key-gamma)" fontFamily="monospace" letterSpacing={1}
            >
              SPOT
            </text>
          </g>
        ) : null}

        {/* 各 scope 固定线型，Call/Put 再用红绿区分；主 scope 只加粗，不改变线型语义。 */}
        {curves.map((curve) => {
          const putSegments = buildSegments(curve.byStrike, strikes, (p) => p.putIV, x, y);
          const callSegments = buildSegments(curve.byStrike, strikes, (p) => p.callIV, x, y);
          const style = SCOPE_LINE_STYLE[curve.scope];
          return (
            <g key={curve.scope} opacity={curve.primary ? 1 : 0.76}>
              {putSegments.map((segment) => (
                <path
                  key={`p-${curve.scope}-${segment}`} d={segment} fill="none"
                  stroke="var(--ms-chart-sell)" strokeWidth={curve.primary ? 2.2 : 1.6}
                  strokeDasharray={style.dash}
                />
              ))}
              {callSegments.map((segment) => (
                <path
                  key={`c-${curve.scope}-${segment}`} d={segment} fill="none"
                  stroke="var(--ms-chart-buy)" strokeWidth={curve.primary ? 2.2 : 1.6}
                  strokeDasharray={style.dash}
                />
              ))}
            </g>
          );
        })}

        {/* 端点圆点（主 scope）：左翼 PUT / 右翼 CALL */}
        {primaryByStrike.get(strikes[0]!)?.putIV !== undefined ? (
          <circle cx={x(0)} cy={y(primaryByStrike.get(strikes[0]!)!.putIV!)} r={3} fill="var(--ms-sell-bright)" />
        ) : null}
        {primaryByStrike.get(strikes.at(-1)!)?.callIV !== undefined ? (
          <circle
            cx={x(strikes.length - 1)} cy={y(primaryByStrike.get(strikes.at(-1)!)!.callIV!)}
            r={3} fill="var(--ms-buy-bright)"
          />
        ) : null}

        {/* ATM 琥珀点（主 scope） */}
        {atmIndex >= 0 && atmIvAtPoint !== undefined ? (
          <g>
            <circle
              cx={x(atmIndex)} cy={y(atmIvAtPoint)} r={4.5}
              fill="var(--ms-brand)" stroke="var(--ms-plot-bg)" strokeWidth={1.5}
            />
            <text
              x={x(atmIndex)} y={y(atmIvAtPoint) + 16} textAnchor="middle"
              fontSize={9} fontWeight={600} fill="var(--ms-brand)" fontFamily="monospace" letterSpacing={1}
            >
              ATM
            </text>
          </g>
        ) : null}

        {/* 翼标签（主 scope） */}
        {primaryByStrike.get(strikes[0]!)?.putIV !== undefined ? (
          <text
            x={x(0) + 6} y={y(primaryByStrike.get(strikes[0]!)!.putIV!) - 8}
            fontSize={9} fill="var(--ms-sell-bright)" fontFamily="monospace" letterSpacing={1}
          >
            PUT 翼
          </text>
        ) : null}
        {primaryByStrike.get(strikes.at(-1)!)?.callIV !== undefined ? (
          <text
            x={x(strikes.length - 1) - 6} y={y(primaryByStrike.get(strikes.at(-1)!)!.callIV!) - 8}
            textAnchor="end" fontSize={9} fill="var(--ms-buy-bright)" fontFamily="monospace" letterSpacing={1}
          >
            CALL 翼
          </text>
        ) : null}

        {/* 底部执行价轴：按实测绘图区与实际标签宽度自动调整密度，保留首尾 */}
        {strikes.map((strike, index) =>
          xLabelIndices.has(index) ? (
            <text
              key={strike}
              x={x(index)} y={HEIGHT - 12} textAnchor="middle"
              fontSize={9} fill="var(--ms-text-tertiary)" fontFamily="monospace"
            >
              {formatPrice(strike, tickSize)}
            </text>
          ) : null,
        )}
      </svg>
      </div>

      {/* 图例 + 脚注（固定 chrome，不随窗口拉伸；多 scope 时每档一项，空态灰显） */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] text-[var(--ms-text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--ms-chart-buy)]" />
          CALL IV
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--ms-chart-sell)]" />
          PUT IV
        </span>
        <span className="flex items-center gap-1.5 text-[var(--ms-text-tertiary)]">
          <span className="inline-block h-px w-4 border-t border-dashed border-[var(--ms-text-tertiary)]" />
          ATM 平线 = 无偏斜参考
        </span>
        {segments.map((seg) => (
          <span
            key={seg.scope}
            className={`flex items-center gap-1.5 ${seg.model ? "" : "opacity-40"}`}
            title={seg.model ? `${SCOPE_LEGEND_LABEL[seg.scope]} · ${seg.model.referenceLabel ?? "期权"}` : `${SCOPE_LEGEND_LABEL[seg.scope]} 周期无数据（空态跳过）`}
          >
            <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true" className="shrink-0">
              <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth={seg === primary ? 2 : 1.5} strokeDasharray={SCOPE_LINE_STYLE[seg.scope].dash} />
            </svg>
            {SCOPE_LEGEND_LABEL[seg.scope]} · {SCOPE_LINE_STYLE[seg.scope].name}{seg === primary ? " · 主" : ""}
          </span>
        ))}
        <span className="ml-auto text-[8px] text-[var(--ms-text-tertiary)]">
          PUT 翼高于 CALL 翼 = 下行偏斜
        </span>
      </div>
    </div>
  );
}
