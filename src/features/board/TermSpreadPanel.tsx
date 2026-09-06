"use client";

import type { OptionProduct, OptionScope, OptionsTermResponse } from "@/api/options";
import { formatPercent } from "@/lib/formatters";

import { useMeasureSize } from "./use-measure-size";

/** 真自适应（面板自适应规范，同 06 第十九轮）：WIDTH/HEIGHT 写死常量废除，画布 = useMeasureSize
 * 实测容器尺寸，viewBox 与 DOM px 1:1；chrome（gutter/字号/区间缝）固定 px，弹性全部给绘图区。
 * 首帧未实测时用兜底尺寸，下一帧实测重渲染。 */
const FALLBACK_W = 560;
const FALLBACK_H = 420;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 20;
/** 上下两区之间的固定缝隙（chrome） */
const ZONE_GAP = 24;
/** 上区 IV 占可用高度的比例（原 560×420 布局的 172/368） */
const IV_SHARE = 172 / 368;

/** 缺失值（null）断开的分段折线 */
function buildSegments<T>(
  points: T[],
  pick: (p: T) => number | null,
  getX: (p: T) => number,
  y: (v: number) => number,
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    const value = pick(point);
    if (value === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${getX(point).toFixed(1)},${y(value).toFixed(1)}`);
  }
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

const SCOPE_LEGEND_LABEL: Record<OptionScope, string> = {
  close: "收盘",
  "0dte": "0DTE",
  d30: "30DTE",
  d90: "90D",
};

export interface TermScopeResult {
  data?: OptionsTermResponse;
  isPending: boolean;
  isError: boolean;
}

/**
 * 10 月间价差 · 成交量 PCR（上下两区共享 DTE 线性 x 轴）：
 *  - 上区 IV 期限结构：官方 IV（到期点实线）+ 自算 ATM IV（serie 散点+短虚线），
 *    倒挂段（近月 IV > 远月）语义色强调；标题读数"近远月 IV 价差"带正负着色与状态字
 *  - 下区 PCR 曲线：成交量 PCR 实线（主）+ OI PCR 虚线（辅）+ PCR=1 参考线，
 *    >1 淡红 tint（put 重于 call）、<1 淡绿
 *  - BCR 占位槽：恒 —，待付费源 P0-3
 *
 * 一·五节联动模型：多 scope 叠加——首项为主 scope（实线全样式），
 * 其余 scope 用虚线 + 低透明度叠加同一坐标域（x/y 域取全体并集，曲线天然对齐）；
 * 空段（close/非 0DTE 日 0dte）静默跳过、图例灰显。
 * 缓存 key 单 scope，前端多 key 并发（React Query 去重）。
 */
export function TermSpreadPanel({
  product: _product,
  scopes,
  results,
}: {
  product: OptionProduct;
  scopes: OptionScope[];
  results: TermScopeResult[];
}) {
  // 实测绘图区容器尺寸；width/height 为 0 表示首帧未实测，用兜底
  const [plotRef, { width: measuredW, height: measuredH }] = useMeasureSize<HTMLDivElement>();
  const WIDTH = measuredW > 0 ? measuredW : FALLBACK_W;
  const HEIGHT = measuredH > 0 ? measuredH : FALLBACK_H;
  /** 上区 IV 期限结构纵向区间（弹性：按比例分可用高度） */
  const IV_B = PAD_T + Math.max(0, HEIGHT - PAD_T - PAD_B - ZONE_GAP) * IV_SHARE;
  /** 下区 PCR 纵向区间（区间缝 ZONE_GAP 固定 px） */
  const PCR_T = IV_B + ZONE_GAP;
  const PCR_B = HEIGHT - PAD_B;
  const PLOT_W = WIDTH - PAD_L - PAD_R;
  const segments = scopes.map((scope, i) => {
    const data = results[i]?.data;
    const empty = !data || !data.has_data || data.expiry_points.length === 0;
    return { scope, data: empty ? undefined : data, primary: i === 0 };
  });
  const withData = segments.filter((s) => s.data !== undefined);
  const allPending = results.length > 0 && results.every((r) => r.isPending);
  const allError = results.length > 0 && results.every((r) => r.isError);

  if (allPending) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">
        加载期限结构中…
      </div>
    );
  }
  if (allError) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center text-sm text-[var(--ms-text-secondary)]">
        期限结构数据加载失败
      </div>
    );
  }
  if (withData.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-[var(--ms-plot-bg)] px-4 text-center">
        <div>
          <p className="text-sm text-[var(--ms-text-secondary)]">暂无期限结构数据</p>
          <p className="mt-1 font-mono text-[9px] tracking-[0.1em] text-[var(--ms-text-tertiary)]">
            以服务端实际到期汇总为准 · 不展示模拟数据
          </p>
        </div>
      </div>
    );
  }

  // 主段 = scopes[0] 若有数据，否则第一个有数据的段（读数行/倒挂强调只跟主段）
  const primarySeg = segments[0]?.data ? segments[0] : withData[0]!;
  const primaryData = primarySeg.data!;

  // ---- 共享 x 轴：DTE 线性，全体 scope 并集（期限结构惯例），近端密点自然成簇 ----
  const dteMax = Math.max(
    1,
    ...withData.flatMap((s) => s.data!.expiry_points.map((p) => p.dte)),
  );
  const xOf = (dte: number) => PAD_L + (dte / dteMax) * PLOT_W;

  // ---- 上区 y 域：全体 scope 的官方 IV + 自算 ATM IV 并集 ----
  const ivValues = withData.flatMap((s) => [
    ...s.data!.expiry_points.map((p) => p.iv_official),
    ...s.data!.serie_points.map((p) => p.atm_iv),
  ]).filter((v): v is number => v !== null);
  const ivMin = Math.min(...ivValues);
  const ivMax = Math.max(...ivValues);
  const ivPad = Math.max(0.004, (ivMax - ivMin) * 0.15);
  const ivLo = Math.max(0, ivMin - ivPad);
  const ivHi = ivMax + ivPad;
  const ivY = (v: number) => PAD_T + ((ivHi - v) / (ivHi - ivLo)) * (IV_B - PAD_T);
  const ivTicks = Array.from({ length: 3 }, (_, i) => ivLo + ((i + 1) / 4) * (ivHi - ivLo));

  // 倒挂段强调（仅主段）：front/back 两条最近有效 serie 之间的连线段
  const spread = primaryData.iv_spread;
  const frontPoint = primaryData.serie_points.find(
    (p) => p.atm_iv !== null && spread !== null && Math.abs(p.atm_iv - spread.front) < 1e-9,
  );
  const backPoint = primaryData.serie_points.find(
    (p) => p.atm_iv !== null && spread !== null && Math.abs(p.atm_iv - spread.back) < 1e-9,
  );

  // ---- 下区 PCR y 域：全体 scope 两条 PCR 线并集，含 1 ----
  const pcrValues = withData.flatMap((s) => [
    ...s.data!.expiry_points.map((p) => p.pcr_vol),
    ...s.data!.expiry_points.map((p) => p.pcr_oi),
  ]).filter((v): v is number => v !== null);
  const pcrLo = Math.min(1, ...pcrValues);
  const pcrHi = Math.max(1, ...pcrValues);
  const pcrPad = Math.max(0.1, (pcrHi - pcrLo) * 0.15);
  const pLo = Math.max(0, pcrLo - pcrPad);
  const pHi = pcrHi + pcrPad;
  const pcrY = (v: number) => PCR_T + ((pHi - v) / (pHi - pLo)) * (PCR_B - PCR_T);
  const pcrTicks = Array.from({ length: 3 }, (_, i) => pLo + ((i + 1) / 4) * (pHi - pLo));

  // x 轴 DTE 刻度（5 档；窄窗口如 0dte 取整后可能重复，去重兜底）
  const dteTicks = [...new Set(Array.from({ length: 5 }, (_, i) => Math.round(((i + 0.5) / 5) * dteMax)))];

  const spreadText = spread
    ? `${spread.spread >= 0 ? "+" : ""}${(spread.spread * 100).toFixed(2)}pt`
    : "--";
  const spreadColor = !spread
    ? "var(--ms-text-secondary)"
    : spread.inverted
      ? "var(--ms-sell-bright)"
      : "var(--ms-buy-bright)";

  const nearest = primaryData.expiry_points[0]!;
  const farthest = primaryData.expiry_points.at(-1)!;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ms-plot-bg)] px-3 py-2">
      {/* 标题读数行：近远月 IV 价差 + 状态字（固定 chrome；主 scope；多 scope 时标注主档） */}
      <div className="mb-1 flex items-baseline gap-2 font-mono text-[10px] leading-6 tabular-nums">
        <span className="text-[var(--ms-text-secondary)]">
          近远月 IV 价差{scopes.length > 1 ? `（主 ${SCOPE_LEGEND_LABEL[primarySeg.scope]}）` : ""}
        </span>
        <span className="text-[11px] font-medium" style={{ color: spreadColor }}>
          {spreadText}
        </span>
        <span style={{ color: spreadColor }}>
          {spread ? (spread.inverted ? "倒挂 · 短期压力" : "正常") : "--"}
        </span>
        <span className="ml-auto text-[9px] text-[var(--ms-text-tertiary)]">
          {spread
            ? `近月 ${formatPercent(spread.front)} / 远月 ${formatPercent(spread.back)}`
            : "有效 serie 不足两条"}
        </span>
      </div>

      {/* 绘图区容器：flex-1 吸收全部弹性，useMeasureSize 实测（整数 floor，第二十八轮 1A）；
          svg 显式整数宽高 + viewBox 同值 1:1 无缩放，父级 overflow-hidden 兜底 */}
      <div ref={plotRef} className="relative min-h-0 flex-1">
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="absolute left-0 top-0 block select-none"
        role="img"
        aria-label="IV 期限结构与 PCR 曲线"
      >
        {/* ===== 上区：IV 期限结构 ===== */}
        {ivTicks.map((tick) => (
          <g key={`iv-${tick}`}>
            <line x1={PAD_L} y1={ivY(tick)} x2={WIDTH - PAD_R} y2={ivY(tick)} stroke="var(--ms-grid)" strokeWidth={1} />
            <text
              x={PAD_L - 4} y={ivY(tick) + 3} textAnchor="end"
              fontSize={9} fill="var(--ms-text-tertiary)" fontFamily="monospace"
            >
              {formatPercent(tick)}
            </text>
          </g>
        ))}

        {/* 倒挂段强调底色（front→back 之间的 x 区间，仅主段） */}
        {spread?.inverted && frontPoint && backPoint ? (
          <rect
            x={xOf(frontPoint.dte)}
            y={PAD_T}
            width={Math.max(2, xOf(backPoint.dte) - xOf(frontPoint.dte))}
            height={IV_B - PAD_T}
            fill="var(--ms-chart-sell)"
            opacity={0.08}
          />
        ) : null}

        {/* 各 scope：官方 IV 线 + 自算 ATM IV（非主段虚线 + 低透明度叠加） */}
        {segments.map((seg) => {
          if (!seg.data) return null;
          const isPrimary = seg === primarySeg;
          const officialSegments = buildSegments(
            seg.data.expiry_points,
            (p) => p.iv_official,
            (p) => xOf(p.dte),
            ivY,
          );
          const atmSegments = buildSegments(
            seg.data.serie_points,
            (p) => p.atm_iv,
            (p) => xOf(p.dte),
            ivY,
          );
          return (
            <g key={seg.scope} opacity={isPrimary ? 1 : 0.55}>
              {officialSegments.map((d) => (
                <path
                  key={d} d={d} fill="none"
                  stroke="var(--ms-brand)" strokeWidth={1.2}
                  strokeDasharray={isPrimary ? undefined : "5 3"}
                />
              ))}
              {atmSegments.map((d) => (
                <path
                  key={d} d={d} fill="none"
                  stroke="var(--ms-key-gamma)" strokeWidth={1} strokeDasharray="4 3"
                />
              ))}
              {seg.data.serie_points.map((p) =>
                p.atm_iv !== null ? (
                  <circle
                    key={`atm-${seg.scope}-${p.label}`}
                    cx={xOf(p.dte)} cy={ivY(p.atm_iv)} r={3}
                    fill="var(--ms-key-gamma)" stroke="var(--ms-plot-bg)" strokeWidth={1}
                  />
                ) : null,
              )}
            </g>
          );
        })}

        {/* 倒挂段加粗连线（仅主段） */}
        {spread?.inverted && frontPoint && backPoint ? (
          <line
            x1={xOf(frontPoint.dte)} y1={ivY(spread.front)}
            x2={xOf(backPoint.dte)} y2={ivY(spread.back)}
            stroke="var(--ms-sell-bright)" strokeWidth={2.5}
          />
        ) : null}
        {/* 近月 / 远月标注（主段） */}
        {nearest.iv_official !== null ? (
          <text
            x={xOf(nearest.dte) + 4} y={ivY(nearest.iv_official) - 5}
            fontSize={9} fill="var(--ms-text-secondary)" fontFamily="monospace"
          >
            近月 DTE {nearest.dte}
          </text>
        ) : null}
        {farthest.iv_official !== null ? (
          <text
            x={xOf(farthest.dte) - 4} y={ivY(farthest.iv_official) - 5} textAnchor="end"
            fontSize={9} fill="var(--ms-text-secondary)" fontFamily="monospace"
          >
            远月 DTE {farthest.dte}
          </text>
        ) : null}

        {/* ===== 下区：PCR 曲线 ===== */}
        {/* PCR>1 淡红 tint（put 重于 call）/ <1 淡绿 */}
        <rect x={PAD_L} y={PCR_T} width={PLOT_W} height={Math.max(0, pcrY(1) - PCR_T)} fill="var(--ms-chart-sell)" opacity={0.05} />
        <rect x={PAD_L} y={pcrY(1)} width={PLOT_W} height={Math.max(0, PCR_B - pcrY(1))} fill="var(--ms-chart-buy)" opacity={0.05} />

        {pcrTicks.map((tick) => (
          <g key={`pcr-${tick}`}>
            <line x1={PAD_L} y1={pcrY(tick)} x2={WIDTH - PAD_R} y2={pcrY(tick)} stroke="var(--ms-grid)" strokeWidth={1} />
            <text
              x={PAD_L - 4} y={pcrY(tick) + 3} textAnchor="end"
              fontSize={9} fill="var(--ms-text-tertiary)" fontFamily="monospace"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {/* PCR=1 参考线 */}
        <line
          x1={PAD_L} y1={pcrY(1)} x2={WIDTH - PAD_R} y2={pcrY(1)}
          stroke="var(--ms-text-tertiary)" strokeWidth={1} strokeDasharray="6 4"
        />
        {/* 各 scope：成交量 PCR 实线（主）/ OI PCR 虚线（辅）；非主段整体降透明度 */}
        {segments.map((seg) => {
          if (!seg.data) return null;
          const isPrimary = seg === primarySeg;
          const pcrVolSegments = buildSegments(
            seg.data.expiry_points,
            (p) => p.pcr_vol,
            (p) => xOf(p.dte),
            pcrY,
          );
          const pcrOiSegments = buildSegments(
            seg.data.expiry_points,
            (p) => p.pcr_oi,
            (p) => xOf(p.dte),
            pcrY,
          );
          return (
            <g key={`pcr-${seg.scope}`} opacity={isPrimary ? 1 : 0.5}>
              {pcrVolSegments.map((d) => (
                <path
                  key={d} d={d} fill="none"
                  stroke="var(--ms-buy-bright)" strokeWidth={1.2}
                  strokeDasharray={isPrimary ? undefined : "5 3"}
                />
              ))}
              {pcrOiSegments.map((d) => (
                <path
                  key={d} d={d} fill="none"
                  stroke="var(--ms-text-secondary)" strokeWidth={1} strokeDasharray="5 3"
                />
              ))}
            </g>
          );
        })}

        {/* 底部 DTE 轴（上下两区共享） */}
        {dteTicks.map((tick) => (
          <text
            key={`dte-${tick}`}
            x={xOf(tick)} y={HEIGHT - 6} textAnchor="middle"
            fontSize={9} fill="var(--ms-text-tertiary)" fontFamily="monospace"
          >
            {tick}d
          </text>
        ))}
      </svg>
      </div>

      {/* 图例 + BCR 占位槽（固定 chrome，不随窗口拉伸；多 scope 时每档一项，空段灰显） */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-[var(--ms-text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--ms-brand)]" />
          官方 IV
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4 border-t border-dashed border-[var(--ms-key-gamma)]" />
          自算 ATM IV
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--ms-buy-bright)]" />
          成交量 PCR
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4 border-t border-dashed border-[var(--ms-text-secondary)]" />
          OI PCR
        </span>
        {segments.map((seg) => (
          <span
            key={seg.scope}
            className={`flex items-center gap-1.5 ${seg.data ? (seg === primarySeg ? "text-[var(--ms-text-primary)]" : "") : "opacity-40"}`}
            title={seg.data ? `${SCOPE_LEGEND_LABEL[seg.scope]} 周期曲线` : `${SCOPE_LEGEND_LABEL[seg.scope]} 周期无数据（空态跳过）`}
          >
            {SCOPE_LEGEND_LABEL[seg.scope]}
            {seg === primarySeg ? "·主" : ""}
          </span>
        ))}
        <span
          className="ml-auto text-[var(--ms-text-tertiary)]"
          title="买卖方向拆分待付费源接入（P0-3）"
        >
          BCR —
        </span>
      </div>
    </div>
  );
}
