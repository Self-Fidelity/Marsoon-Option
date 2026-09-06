"use client";

import { useEffect, useRef, useState } from "react";

import { formatNotional, formatPrice } from "@/lib/formatters";

import { liveFocus, useBoardFocusStore } from "./board-focus-store";
import type { GexBreakdownModel } from "./gex-breakdown-model";
import { SpotFollowButton } from "./spot-follow-button";
import { useMeasureSize } from "./use-measure-size";
import { useSpotFollow } from "./use-spot-follow";

/** 真自适应（06面板迭代文档 第十九轮）：写死 viewBox 宽 920 废除，宽 = useMeasureSize 实测容器宽；
 * 行高 ROW_H 固定（chrome），高度随行数增长，纵向"内容滚动"保留（尺寸失配滚动条仍禁止）。
 * 横向布局：中轴居中，strike 列/两侧数值列/gutter 全部固定 px，条形区吸收全部弹性。
 * LOD：实测宽 < LOD_BARS_ONLY_W 进入 barsOnly（只画填充条+spot/wall/flip 水平线，隐藏全部文字，
 * 文字列 chrome 释放给条形区）；标记线竖向间距 < LOD_LABEL_MIN_GAP 时该对线只画线不画标签。 */
const FALLBACK_W = 920;
const HEADER = 26;
const ROW_H = 32;
const FOOTER = 8;
const BAR_H = 16;

/** 左侧 put 数值列右缘 x（固定） */
const PUT_VALUE_X = 96;
/** 中轴两侧 gutter 半宽（固定） */
const CENTER_GAP = 40;
/** 右缘留白（固定） */
const EDGE_PAD = 8;
/** 右侧 call 数值列距右缘（固定） */
const CALL_VALUE_PAD_R = 56;
/** 数值列与条形区间距（固定） */
const VALUE_BAR_GAP = 8;
const EDGE_LEFT = 8;

/** LOD 阈值：实测宽小于此值进入 barsOnly（只画填充条 + spot/wall/flip 水平线，隐藏全部文字） */
const LOD_BARS_ONLY_W = 560;
/** 纵向 LOD：相邻水平标记线中心距小于此值时视为拥挤，该对线只画线不画标签 */
const LOD_LABEL_MIN_GAP = 15;

interface LevelLine {
  kind: "callWall" | "putWall" | "gammaFlip" | "spot";
  value: number;
  y: number;
}

/**
 * 08 Call/Put GEX 拆分：每个执行价一根双向条形。
 * 口径：put_gex 后端已带负号，此处只取绝对值画长度；net = call + put。
 * 缺失的 Wall / Flip 一律不绘制，不降级为 0。
 */
export function GexBreakdownPanel({
  model,
  spotFollow: externalFollow,
}: {
  model: GexBreakdownModel;
  spotFollow?: ReturnType<typeof useSpotFollow<HTMLDivElement>>;
}) {
  const { rows, tickSize } = model;
  const [measureRef, { width: measuredW }] = useMeasureSize<HTMLDivElement>();
  // 追踪标的价居中（共享 hook use-spot-follow）：开启后保持距现货最近的执行价行垂直居中，手动滚动即关闭
  const localFollow = useSpotFollow<HTMLDivElement>();
  const spotFollow = externalFollow ?? localFollow;
  // 追踪开启期间，现货价/行集变化 → 行 DOM 重建后即时保持居中（查询在 hook 的 rAF 内进行）
  useEffect(() => {
    if (spotFollow.follow) spotFollow.keepSpotCentered();
  }, [spotFollow.follow, model.spot, rows, spotFollow.keepSpotCentered]);
  // 05 下钻联动（第三十四轮 B5）：focus.strike → 最接近档画 ~2s 高亮框；陈旧 focus（at+30s）忽略
  const focus = useBoardFocusStore((s) => s.focus);
  const focusHandledAtRef = useRef(0);
  const [flashStrike, setFlashStrike] = useState<number | null>(null);
  useEffect(() => {
    const live = liveFocus(focus);
    if (!live || live.strike === undefined || live.at === focusHandledAtRef.current) return;
    focusHandledAtRef.current = live.at;
    if (rows.length === 0) return;
    const nearest = rows.reduce((best, row) =>
      Math.abs(row.strike - live.strike!) < Math.abs(best.strike - live.strike!) ? row : best,
    );
    setFlashStrike(nearest.strike);
    const timer = setTimeout(() => setFlashStrike(null), 2000);
    return () => clearTimeout(timer);
  }, [focus, rows]);
  // 首帧未实测时用兜底宽，下一帧实测重渲染；条形区弹性 = 实测宽 − 固定 chrome
  const width = measuredW > 0 ? measuredW : FALLBACK_W;
  // LOD：横向过窄 → barsOnly，隐藏全部文字（列头/数值/strike/标记标签/贴边标签/页脚），
  // 文字列 chrome 释放给条形区；纵向 → 拥挤标记线只画线不画标签（见 levels 渲染处）
  const barsOnly = width < LOD_BARS_ONLY_W;
  const CENTER_X = width / 2;
  const centerGap = barsOnly ? 12 : CENTER_GAP;
  const PUT_BAR_RIGHT = CENTER_X - centerGap;
  const CALL_BAR_LEFT = CENTER_X + centerGap;
  const CALL_VALUE_X = width - CALL_VALUE_PAD_R;
  const EDGE_RIGHT = width - EDGE_PAD;
  const BAR_LEFT_LIMIT = barsOnly ? EDGE_LEFT : PUT_VALUE_X + VALUE_BAR_GAP;
  const MAX_BAR = Math.max(0, PUT_BAR_RIGHT - BAR_LEFT_LIMIT);

  if (rows.length === 0) {
    return (
      <div className="grid min-h-[320px] place-items-center bg-[var(--ms-plot-bg)] px-4 py-10 text-center text-sm text-[var(--ms-text-secondary)]">
        当前快照没有与 MarketState 到期日匹配的执行价数据
      </div>
    );
  }

  const maxExposure = Math.max(
    1,
    ...rows.flatMap((row) => [Math.abs(row.putGEX), Math.abs(row.callGEX)]),
  );
  const height = HEADER + rows.length * ROW_H + FOOTER;

  const strikeDesc = [...rows].sort((a, b) => b.strike - a.strike);
  const topStrike = strikeDesc[0]!.strike;
  const bottomStrike = strikeDesc.at(-1)!.strike;
  const span = Math.max(tickSize, topStrike - bottomStrike);

  // strike → y（行中心）；水平线（墙/翻转）按价格插值，可落在两行之间
  const yOfStrike = (strike: number) =>
    HEADER + ((topStrike - strike) / span) * (rows.length - 1) * ROW_H + ROW_H / 2;

  const levels: LevelLine[] = [];
  // 锚点被上限截到窗外时画贴边标记，不允许静默丢失
  const edgeMarkers: Array<{ kind: LevelLine["kind"]; value: number; above: boolean }> = [];
  const addLevel = (kind: LevelLine["kind"], value: number | undefined) => {
    if (value === undefined) return;
    if (value >= bottomStrike && value <= topStrike) {
      levels.push({ kind, value, y: yOfStrike(value) });
    } else {
      edgeMarkers.push({ kind, value, above: value > topStrike });
    }
  };
  addLevel("callWall", model.callWall);
  addLevel("putWall", model.putWall);
  addLevel("gammaFlip", model.gammaFlip);
  addLevel("spot", model.spot);

  // 纵向 LOD：相邻标记线竖向间距过近时标签必然叠字，该对线只画线不画标签
  const crowdedKinds = new Set<LevelLine["kind"]>();
  const levelsByY = [...levels].sort((a, b) => a.y - b.y);
  for (let i = 0; i < levelsByY.length - 1; i++) {
    if (levelsByY[i + 1]!.y - levelsByY[i]!.y < LOD_LABEL_MIN_GAP) {
      crowdedKinds.add(levelsByY[i]!.kind);
      crowdedKinds.add(levelsByY[i + 1]!.kind);
    }
  }

  const levelStyle = {
    callWall: { stroke: "var(--ms-success)", label: "CALL WALL" },
    putWall: { stroke: "var(--ms-danger)", label: "PUT WALL" },
    gammaFlip: { stroke: "var(--ms-brand)", label: "GAMMA FLIP" },
    spot: { stroke: "var(--ms-key-gamma)", label: "SPOT" },
  } as const;

  // 现货高亮行：取距现货最近的档（原 tickSize×2 容差在 GC（tick 0.1、档距 10）下永不命中）
  const spotStrike =
    model.spot === undefined || rows.length === 0
      ? null
      : rows.reduce((best, row) =>
          Math.abs(row.strike - model.spot!) < Math.abs(best.strike - model.spot!) ? row : best,
        ).strike;

  return (
    // setRootEl 挂根容器：滚动由外层 DockPanelBody 承载（内容纵向滚动型例外口径），hook 向上解析实际滚动容器
    <div ref={spotFollow.setRootEl} className="overflow-hidden bg-[var(--ms-plot-bg)] px-3 py-4">
      {/* 工具行（08 原无任何控件行，新建一行只放追踪开关；barsOnly 下其余 chrome 全隐藏，本行保留以维持功能可用） */}
      <div className="mb-2 flex items-center justify-end">
        <SpotFollowButton follow={spotFollow.follow} onToggle={spotFollow.toggleFollow} />
      </div>
      {/* 实测容器（整数 floor，第二十八轮 1A）：svg 显式整数宽 + h-auto 按 viewBox 比出高（1:1 无缩放），高随行数（内容滚动保留） */}
      <div ref={measureRef}>
        <svg
          width={width}
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto"
          role="img"
          aria-label="Call Put GEX 拆分"
        >
        {/* 列头（barsOnly 隐藏） */}
        {barsOnly ? null : (
          <>
        <text x={PUT_BAR_RIGHT} y={14} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ms-text-tertiary)" letterSpacing="0.8" className="font-mono">
          PUT GEX ←
        </text>
        <text x={CENTER_X} y={14} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ms-text-tertiary)" letterSpacing="0.8" className="font-mono">
          STRIKE
        </text>
        <text x={CALL_BAR_LEFT} y={14} fontSize={11} fontWeight={600} fill="var(--ms-text-tertiary)" letterSpacing="0.8" className="font-mono">
          → CALL GEX
        </text>
          </>
        )}

        {/* 中轴 */}
        <line
          x1={CENTER_X} y1={HEADER} x2={CENTER_X} y2={height - FOOTER}
          stroke="var(--ms-axis)" strokeWidth={1} opacity={0.4}
        />

        {rows.map((row, index) => {
          const rowTop = HEADER + index * ROW_H;
          const barY = rowTop + (ROW_H - BAR_H) / 2;
          const textY = rowTop + ROW_H / 2 + 4;
          const putWidth = (Math.abs(row.putGEX) / maxExposure) * MAX_BAR;
          const callWidth = (Math.abs(row.callGEX) / maxExposure) * MAX_BAR;
          const isSpotRow = row.strike === spotStrike;

          return (
            // data-spot-row 打在行 <g> 上（barsOnly 档文字全隐藏但行元素仍在，追踪保持可用）；
            // svg 元素无 offsetTop，hook 内用 getBoundingClientRect 换算
            <g key={row.strike} data-spot-row={isSpotRow ? true : undefined}>
              <title>
                {`Net GEX ${formatNotional(row.netGEX)}${row.qualityFlags ? ` · quality_flags=${row.qualityFlags}` : ""}`}
              </title>
              {isSpotRow ? (
                <rect
                  x={EDGE_LEFT} y={rowTop + 2}
                  width={EDGE_RIGHT - EDGE_LEFT} height={ROW_H - 4}
                  fill="var(--ms-brand-dim)"
                />
              ) : null}
              {/* 05 下钻高亮框（第三十四轮 B5）：focus.strike 最近档，2s 后移除 */}
              {flashStrike === row.strike ? (
                <rect
                  x={EDGE_LEFT} y={rowTop + 1}
                  width={EDGE_RIGHT - EDGE_LEFT} height={ROW_H - 2}
                  fill="none" stroke="var(--ms-brand)" strokeWidth={1.5} rx={3}
                />
              ) : null}
              {putWidth > 0 ? (
                <rect
                  x={PUT_BAR_RIGHT - putWidth} y={barY}
                  width={putWidth} height={BAR_H}
                  fill="var(--ms-chart-sell)"
                />
              ) : null}
              {callWidth > 0 ? (
                <rect
                  x={CALL_BAR_LEFT} y={barY}
                  width={callWidth} height={BAR_H}
                  fill="var(--ms-chart-buy)"
                />
              ) : null}
              {barsOnly ? null : (
                <>
              <text x={PUT_VALUE_X} y={textY} textAnchor="end" fontSize={12} fill="var(--ms-sell-bright)" className="font-mono tabular-nums">
                {formatNotional(row.putGEX)}
              </text>
              <text x={CALL_VALUE_X} y={textY} fontSize={12} fill="var(--ms-buy-bright)" className="font-mono tabular-nums">
                {formatNotional(row.callGEX)}
              </text>
              <text x={CENTER_X} y={textY} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--ms-text-primary)" className="font-mono tabular-nums">
                {formatPrice(row.strike, tickSize)}
              </text>
                </>
              )}
            </g>
          );
        })}

        {/* 墙 / 翻转 / 现货线：在可视区间内才绘制；标签带底色，压柱/压值仍可读 */}
        {levels.map((level) => {
          const style = levelStyle[level.kind];
          const isPut = level.kind === "putWall";
          const isFlip = level.kind === "gammaFlip";
          const isSpot = level.kind === "spot";
          // LOD：barsOnly 或纵向拥挤时只画线不画标签
          const showLabel = !barsOnly && !crowdedKinds.has(level.kind);
          const label = `${style.label} ${formatPrice(level.value, tickSize)}`;
          const labelWidth = label.length * 6.2 + 10;
          // Flip 标签放在数值列左侧、线上方，避开两侧每行都有的数值标签；Spot 左上
          const labelX = isPut ? EDGE_LEFT : isFlip ? CALL_VALUE_X - 8 : isSpot ? EDGE_LEFT + 4 : EDGE_RIGHT;
          const labelY = isPut ? level.y + 13 : level.y - 4;
          return (
            <g key={level.kind}>
              <line
                x1={EDGE_LEFT} y1={level.y} x2={EDGE_RIGHT} y2={level.y}
                stroke={style.stroke} strokeWidth={isSpot ? 1.25 : 1} strokeDasharray="5 3" opacity={0.85}
              />
              {showLabel ? (
                <>
              <rect
                x={isPut || isSpot ? labelX - 4 : labelX - labelWidth + 4}
                y={labelY - 9}
                width={labelWidth}
                height={12}
                fill="var(--ms-plot-bg)"
                opacity={0.92}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={isPut || isSpot ? "start" : "end"}
                fontSize={10} fontWeight={600} fill={style.stroke} letterSpacing={1} className="font-mono"
              >
                {label}
              </text>
                </>
              ) : null}
            </g>
          );
        })}

        {/* 窗外锚点贴边标记：小三角指向窗外方向 + 带底色数值标签，同一边横向错开 */}
        {edgeMarkers.map((marker, index) => {
          const style = levelStyle[marker.kind];
          const label = `${style.label} ${formatPrice(marker.value, tickSize)}`;
          const labelWidth = label.length * 6.2 + 10;
          const x0 = EDGE_LEFT + index * 150;
          const y = marker.above ? HEADER + 4 : height - FOOTER - 4;
          const triangle = marker.above
            ? `${x0},${y + 4} ${x0 + 12},${y + 4} ${x0 + 6},${y - 4}`
            : `${x0},${y - 4} ${x0 + 12},${y - 4} ${x0 + 6},${y + 4}`;
          return (
            <g key={marker.kind}>
              <polygon points={triangle} fill={style.stroke} />
              {barsOnly ? null : (
                <>
              <rect
                x={x0 + 16}
                y={y - 6}
                width={labelWidth}
                height={12}
                fill="var(--ms-plot-bg)"
                opacity={0.92}
              />
              <text
                x={x0 + 20}
                y={y + 3}
                fontSize={10} fontWeight={600} fill={style.stroke} letterSpacing={1} className="font-mono"
              >
                {label}
              </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      </div>

      {barsOnly ? null : (
      <div className="mt-3 flex items-center justify-between border-t border-[var(--ms-separator)] pt-3 font-mono text-[8px] text-[var(--ms-text-tertiary)]">
        <span>PUT GEX 已使用后端负号</span>
        <span>NET = CALL + PUT</span>
      </div>
      )}
    </div>
  );
}
