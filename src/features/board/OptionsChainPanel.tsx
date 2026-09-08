import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  OptionsApiError,
  type OptionsChainSide,
} from "@/api/options";
import { useOptionsChain } from "@/features/options/use-options-chain";
import { dataAvailabilityMessage } from "@/lib/data-messages";
import {
  formatInteger,
  formatNotional,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  sanitizeUserFacingText,
} from "@/lib/formatters";

import { liveFocus, useBoardFocusStore } from "./board-focus-store";
import { useBoardWindowStore } from "./board-window-store";
import {
  buildChainMarks,
  CHAIN_SORT_TABS,
  sliceAtmWindow,
  sortChainRows,
  type ChainMark,
  type ChainSortKey,
  type OptionsChainModel,
} from "./options-chain-model";
import { SpotFollowButton } from "./spot-follow-button";
import { useMeasureSize } from "./use-measure-size";
import { useSpotFollow } from "./use-spot-follow";

/** 列 LOD（第三十一轮）：窗口变窄按优先级从外到内砍列，砍列优先于挤压——表格永不截断/压缩单元格。
 *  盘中核心报价列（ASK/BID/LAST）与中轴 K 不动；收盘口径没有盘口，只保留 SETTLE。
 *  CHG% 恒 null（昨收待接入）第三批就砍。
 *  阈值按列均宽 ~55px 估算：每砍一对约省 110px。 */
const CHAIN_LOD_TIERS: Array<{ minW: number; hidden: string[] }> = [
  { minW: 1100, hidden: [] },
  { minW: 950, hidden: ["vega", "theta"] },
  { minW: 820, hidden: ["vega", "theta", "chg"] },
  { minW: 700, hidden: ["vega", "theta", "chg", "iv"] },
  { minW: 600, hidden: ["vega", "theta", "chg", "iv", "vol"] },
  { minW: 0, hidden: ["vega", "theta", "chg", "iv", "vol", "delta", "oi"] },
];
/** 首帧未实测兜底宽（下一帧实测重渲染） */
const CHAIN_FALLBACK_W = 1200;

/** 表头列定义（与 SideCells cells 的 key 一一对应；外侧 → 中轴）。
 *  title = 一句话白话解释（第三十二轮，小白向：这是什么+怎么看） */
const SIDE_HEADERS: Array<{ key: string; label: string; title?: string }> = [
  { key: "oi", label: "OI", title: "持仓量：这个行权价上还没平仓的合约总数，越大说明越多资金盯住这个价位" },
  { key: "vol", label: "VOL", title: "成交量：当天这个行权价实际成交的合约数" },
  { key: "iv", label: "IV%", title: "隐含波动率：市场预期的未来波动幅度，越高说明期权越贵、情绪越紧张" },
  { key: "vega", label: "V", title: "Vega：隐含波动率每变化 1 个点，期权价格大约变动多少钱" },
  { key: "theta", label: "Θ", title: "Theta：时间价值每天大约衰减多少（买方的成本、卖方的收入）" },
  { key: "delta", label: "Δ", title: "Delta：标的价格变动 1 点，期权价格大约变动多少（Call 为正、Put 为负）" },
  { key: "chg", label: "CHG%", title: "涨跌幅：相对昨日结算价的变化（数据源待接入，暂无真值）" },
  { key: "last", label: "LAST", title: "最新成交价（带点下划线 = 结算价）" },
  { key: "bid", label: "BID", title: "买一价：当前市场上最高的买入报价" },
  { key: "ask", label: "ASK", title: "卖一价：当前市场上最低的卖出报价" },
];

/** 标注 chip 的展示优先级与配色（同一档可叠多个标注） */
const MARK_ORDER: ChainMark[] = ["callWall", "putWall", "keyGamma", "maxPain", "atm"];

const MARK_STYLE: Record<ChainMark, { label: string; className: string }> = {
  callWall: {
    label: "CALL WALL",
    className:
      "border-[var(--ms-success)] bg-[color-mix(in_srgb,var(--ms-success)_15%,transparent)] text-[var(--ms-success)]",
  },
  putWall: {
    label: "PUT WALL",
    className:
      "border-[var(--ms-danger)] bg-[color-mix(in_srgb,var(--ms-danger)_15%,transparent)] text-[var(--ms-danger)]",
  },
  keyGamma: {
    label: "MAX Γ",
    className:
      "border-[var(--ms-key-gamma)] bg-[color-mix(in_srgb,var(--ms-key-gamma)_15%,transparent)] text-[var(--ms-key-gamma)]",
  },
  maxPain: {
    label: "MAX PAIN",
    className:
      "border-[var(--ms-text-tertiary)] bg-[color-mix(in_srgb,var(--ms-text-tertiary)_15%,transparent)] text-[var(--ms-text-secondary)]",
  },
  atm: {
    label: "ATM",
    className:
      "border-[var(--ms-brand)] bg-[color-mix(in_srgb,var(--ms-brand)_15%,transparent)] text-[var(--ms-brand)]",
  },
};

/** Strike 格的外框色只取最高优先级一个，避免多标注时花哨 */
function boxColorOf(marks: ChainMark[]): string | undefined {
  if (marks.includes("callWall")) return "var(--ms-success)";
  if (marks.includes("putWall")) return "var(--ms-danger)";
  if (marks.includes("keyGamma")) return "var(--ms-key-gamma)";
  if (marks.includes("maxPain")) return "var(--ms-text-tertiary)";
  return undefined;
}

function formatGamma(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(4);
}

function formatDelta(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(3);
}

/** theta 展示口径：每日（引擎输出每年，÷365），自带负号 */
function formatThetaDaily(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : (value / 365).toFixed(2);
}

/** vega 展示口径：每 1 vol pt（引擎输出每 1.00 波动率，÷100） */
function formatVegaPt(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : (value / 100).toFixed(2);
}

/**
 * Spot / Gamma Flip / Expected Move ±1σ 横贯线行（仅行权价序下位置才有意义）。
 * SPOT 为实线亮线 + 价格徽标；徽标固定在中轴 K 列右侧空档（K 与 PUT 侧 ASK 之间，
 * 避免与上下行 K 格上的 ATM/WALL chip 垂直打架），并携带 ±GEX 状态：
 * spot > gamma_flip → 正 GEX（绿），spot < gamma_flip → 负 GEX（红），flip 为 null 或相等不显示。
 */
function LevelLineRow({
  kind,
  value,
  tickSize,
  flip = null,
  colSpan = 21,
}: {
  kind: "spot" | "flip" | "emUpper" | "emLower";
  value: number;
  tickSize: number;
  flip?: number | null;
  /** 列 LOD 下实际列数（第三十一轮：默认 21 = 10+1+10 全列） */
  colSpan?: number;
}) {
  const isSpot = kind === "spot";
  const isEm = kind === "emUpper" || kind === "emLower";
  const color = isSpot ? "var(--ms-key-gamma)" : isEm ? "var(--ms-text-tertiary)" : "var(--ms-brand)";
  const label = isSpot ? "SPOT" : isEm ? "±1σ" : "GAMMA FLIP";
  const gexState = isSpot && flip !== null && value !== flip ? (value > flip ? "pos" : "neg") : null;
  const gexColor = gexState === "pos" ? "var(--ms-success)" : "var(--ms-danger)";
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} className="relative h-[3px] p-0">
        <div className={isSpot ? "border-t-2" : "border-t-2 border-dashed"} style={{ borderColor: color }} />
        {isSpot ? (
          <span
            className="absolute -top-[8px] left-1/2 ml-10 rounded-sm border px-1 py-px font-mono text-[9px] font-semibold tracking-[0.08em] whitespace-nowrap"
            style={{ color, borderColor: color, background: "var(--ms-plot-bg)" }}
          >
            {label} {formatPrice(value, tickSize)}
            {gexState !== null && (
              <span style={{ color: gexColor }}> · {gexState === "pos" ? "+GEX" : "−GEX"}</span>
            )}
          </span>
        ) : (
          <span
            className={`absolute -top-[8px] bg-[var(--ms-plot-bg)] px-1 font-mono text-[10px] font-semibold tracking-[0.1em] ${isEm ? "left-2" : "right-2"}`}
            style={{ color }}
          >
            {label} {formatPrice(value, tickSize)}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * 单侧 10 个数据格：列序按"价格贴中轴、字母按重要性往外"排列
 * （外侧 → 中轴：OI | VOL | IV% | V | Θ | Δ | CHG% | LAST | BID | ASK），
 * mirror 时整组反序即为 Put 侧（中轴 → 外侧：ASK | BID | LAST | CHG% | Δ | Θ | V | IV% | VOL | OI）。
 * itm=true 时整侧单元格加 6% 淡色 tint（call 绿 / put 红），弱于 WALL 行 15% tint；
 * OI/VOL 格数字背后加按当侧当列窗口最大值归一的横向微条；
 * IV 非回退时按当侧窗口 min/max 归一做冷(品牌蓝)→暖(红)色阶，回退档保持灰显。
 */
function SideCells({
  side,
  tone,
  tickSize,
  mirror = false,
  itm = false,
  oiMax = 0,
  volMax = 0,
  ivRange = null,
  hidden,
}: {
  side: OptionsChainSide | null;
  tone: "call" | "put";
  tickSize: number;
  mirror?: boolean;
  itm?: boolean;
  oiMax?: number;
  volMax?: number;
  ivRange?: { min: number; max: number } | null;
  /** 列 LOD 隐藏列 key 集（第三十一轮）；空/缺省 = 全列 */
  hidden?: ReadonlySet<string>;
}) {
  const accent = tone === "call" ? "text-[var(--ms-buy-bright)]" : "text-[var(--ms-sell-bright)]";
  const dim = "text-[var(--ms-text-tertiary)]";
  const strong = "text-[var(--ms-text-primary)]";
  const plain = "text-[var(--ms-text-secondary)]";
  const cell = "relative px-1 py-1 text-right font-mono text-[12px] leading-5 tabular-nums";

  const ivDim = side === null || side.iv === null || side.iv_fallback;
  const ivColor =
    !ivDim && ivRange && side?.iv != null
      ? (() => {
          const t = ivRange.max > ivRange.min ? (side.iv - ivRange.min) / (ivRange.max - ivRange.min) : 0.5;
          return `color-mix(in srgb, var(--ms-brand) ${Math.round((1 - t) * 100)}%, var(--ms-danger))`;
        })()
      : undefined;
  const bidAsk = (value: number | null | undefined) =>
    value == null || value === 0 ? "—" : formatPrice(value, tickSize);
  // 微条归一：分侧分列窗口最大值；0 或缺失不出条
  const oiBar = side?.oi != null && oiMax > 0 ? Math.min(1, side.oi / oiMax) : null;
  const volBar = side?.volume != null && volMax > 0 ? Math.min(1, side.volume / volMax) : null;
  const cells: Array<{
    key: string;
    text: string;
    className: string;
    title?: string;
    color?: string;
    bar?: number | null;
    barColor?: string;
  }> = [
    { key: "oi", text: formatInteger(side?.oi ?? undefined), className: side?.oi == null ? dim : plain, bar: oiBar, barColor: "color-mix(in srgb, var(--ms-brand) 18%, transparent)" },
    { key: "vol", text: formatInteger(side?.volume ?? undefined), className: side?.volume == null ? dim : plain, bar: volBar, barColor: "color-mix(in srgb, var(--ms-text-tertiary) 20%, transparent)" },
    { key: "iv", text: side?.iv == null ? "--" : formatPercent(side.iv), className: ivDim ? dim : ivColor ? strong : accent, color: ivColor },
    { key: "vega", text: side ? formatVegaPt(side.vega) : "--", className: side ? strong : dim },
    { key: "theta", text: side ? formatThetaDaily(side.theta) : "--", className: side ? strong : dim },
    { key: "delta", text: side ? formatDelta(side.delta) : "--", className: side ? strong : dim, title: "Delta：标的价格变动 1 点，期权价格大约变动多少" },
    // 昨收未接入，恒为占位
    { key: "chg", text: "--", className: dim, title: "昨收待接入" },
    {
      key: "last",
      text: formatPrice(side?.last ?? undefined, tickSize),
      className: side?.last == null ? dim : side.is_settlement ? `${strong} underline decoration-dotted underline-offset-2` : strong,
      title: side?.is_settlement ? "结算价" : undefined,
    },
    { key: "bid", text: bidAsk(side?.bid), className: side?.bid == null || side.bid === 0 ? dim : strong },
    { key: "ask", text: bidAsk(side?.ask), className: side?.ask == null || side.ask === 0 ? dim : strong },
  ];
  const filtered = hidden ? cells.filter((item) => !hidden.has(item.key)) : cells;
  const ordered = mirror ? [...filtered].reverse() : filtered;
  const itmTint = itm
    ? tone === "call"
      ? "color-mix(in srgb, var(--ms-success) 6%, transparent)"
      : "color-mix(in srgb, var(--ms-danger) 6%, transparent)"
    : undefined;
  return (
    <>
      {ordered.map((item) => (
        <td
          key={item.key}
          className={`${cell} ${item.className}`}
          title={item.title}
          style={{ background: itmTint, color: item.color }}
        >
          {item.bar != null && item.bar > 0 ? (
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-1 rounded-[2px] ${mirror ? "right-0" : "left-0"}`}
              style={{ width: `${item.bar * 100}%`, background: item.barColor }}
            />
          ) : null}
          <span className="relative">{item.text}</span>
        </td>
      ))}
    </>
  );
}

/** 下钻明细卡的单侧（Call 或 Put）；strike 用于计算 BE 盈亏平衡 */
function SideDetail({
  title,
  side,
  tone,
  tickSize,
  strike,
  settlement,
}: {
  title: string;
  side: OptionsChainSide | null;
  tone: "call" | "put";
  tickSize: number;
  strike: number;
  settlement: boolean;
}) {
  const accent = tone === "call" ? "text-[var(--ms-buy-bright)]" : "text-[var(--ms-sell-bright)]";
  if (!side) {
    return (
      <div className="rounded-md border border-[var(--ms-separator)] p-2.5">
        <p className={`font-mono text-[9px] tracking-[0.12em] ${accent}`}>{title}</p>
        <p className="mt-2 text-[11px] text-[var(--ms-text-tertiary)]">无持仓 / 成交 / 报价，该侧已被剔除</p>
      </div>
    );
  }
  const spread =
    side.bid !== null && side.ask !== null ? side.ask - side.bid : null;
  // 盈亏平衡：Call = K + 权利金，Put = K − 权利金；参考价优先 MID，无 MID 退 LAST，都无则 —
  const beRef = settlement ? side.last : (side.mid ?? side.last);
  const be = beRef == null ? null : tone === "call" ? strike + beRef : strike - beRef;
  const quoteFields: Array<{ label: string; value: string; note?: string }> = settlement
    ? [{ label: "SETTLE", value: formatPrice(side.last ?? undefined, tickSize) }]
    : [
        { label: "BID", value: formatPrice(side.bid ?? undefined, tickSize) },
        { label: "ASK", value: formatPrice(side.ask ?? undefined, tickSize) },
        { label: "SPRD", value: formatPrice(spread ?? undefined, tickSize) },
        { label: "LAST", value: formatPrice(side.last ?? undefined, tickSize), note: side.is_settlement ? "结算价" : undefined },
        { label: "MID", value: formatPrice(side.mid ?? undefined, tickSize) },
      ];
  const fields: Array<{ label: string; value: string; dim?: boolean; note?: string; className?: string }> = [
    { label: "IV", value: side.iv == null ? "--" : formatPercent(side.iv), dim: side.iv_fallback, note: side.iv_fallback ? "ATM 回退" : undefined },
    { label: "Δ", value: formatDelta(side.delta) },
    { label: "Γ", value: formatGamma(side.gamma) },
    { label: "Θ(日)", value: formatThetaDaily(side.theta) },
    { label: "V(1pt)", value: formatVegaPt(side.vega) },
    { label: "GEX", value: formatNotional(side.gex) },
    { label: "OI", value: formatInteger(side.oi ?? undefined) },
    { label: "VOL", value: formatInteger(side.volume ?? undefined) },
    ...quoteFields,
    {
      label: "BE",
      value: be == null ? "—" : formatPrice(be, tickSize),
      note: be == null ? undefined : settlement ? "以 SETTLE 计" : side.mid != null ? "以 MID 计" : "以 LAST 计",
    },
    {
      label: "CHG",
      value: side.change == null ? "--" : formatSignedPrice(side.change, tickSize),
      note: side.change == null ? "昨收待接入" : undefined,
      className:
        side.change == null
          ? undefined
          : side.change > 0
            ? "text-[var(--ms-buy-bright)]"
            : side.change < 0
              ? "text-[var(--ms-sell-bright)]"
              : undefined,
    },
    {
      label: "CHG%",
      value: side.change_pct == null ? "--" : formatPercent(side.change_pct, { signed: true }),
      note: side.change_pct == null ? "昨收待接入" : undefined,
      className:
        side.change_pct == null
          ? undefined
          : side.change_pct > 0
            ? "text-[var(--ms-buy-bright)]"
            : side.change_pct < 0
              ? "text-[var(--ms-sell-bright)]"
              : undefined,
    },
  ];
  return (
    <div className="rounded-md border border-[var(--ms-separator)] p-2.5">
      <p className={`font-mono text-[9px] tracking-[0.12em] ${accent}`}>{title}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {fields.map((field) => (
          <div key={field.label} className="flex items-baseline justify-between gap-2">
            <dt className="font-mono text-[9px] text-[var(--ms-text-tertiary)]">{field.label}</dt>
            <dd
              className={`font-mono text-[11px] tabular-nums ${
                field.dim
                  ? "text-[var(--ms-text-tertiary)]"
                  : (field.className ?? "text-[var(--ms-text-primary)]")
              }`}
              title={field.note}
            >
              {field.value}
              {field.note ? <span className="ml-1 text-[8px] text-[var(--ms-text-tertiary)]">{field.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * 09 期权链下钻：Strike 居中镜像表（左 Call 绿 / 右 Put 红），行点击摊开明细。
 * 到期切换独立于 board scope：组件内 useState，初始为空 = 后端选最小 DTE。
 */
export function OptionsChainPanel({ model, panelId }: { model: OptionsChainModel; panelId: string }) {
  const { product, tickSize } = model;
  const scope = model.scope ?? "0dte";
  const settlement = scope === "close";
  const expiration = useBoardWindowStore((state) => state.windows[panelId]?.chainExpiration);
  const setChainExpiration = useBoardWindowStore((state) => state.setChainExpiration);
  const [sort, setSort] = useState<ChainSortKey>("strike");
  const [showAll, setShowAll] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  // 05 下钻联动（第三十四轮 B5）：focus.expiry 命中本窗到期 tabs 则切过去并短暂高亮，
  // 找不到就不动；at + 30s 后的陈旧 focus 忽略。最小侵入：只读 focus，不改自有到期选择语义。
  const focus = useBoardFocusStore((s) => s.focus);
  const focusHandledAtRef = useRef(0);
  const [flashExpiry, setFlashExpiry] = useState<number | null>(null);
  // 列 LOD 实测（第三十一轮，面板自适应规范）：表格容器实测宽驱动砍列，首帧兜底全列
  const [measureRef, { width: measuredW }] = useMeasureSize<HTMLDivElement>();
  const tableW = measuredW > 0 ? measuredW : CHAIN_FALLBACK_W;
  const hiddenCols = new Set(
    CHAIN_LOD_TIERS.find((tier) => tableW >= tier.minW)!.hidden,
  );
  if (settlement) {
    hiddenCols.add("bid");
    hiddenCols.add("ask");
  }
  const sideColCount = SIDE_HEADERS.length - hiddenCols.size;

  // expiration 为空时与 BoardView 的自动查询同 key（共享缓存）；选定到期后独立拉取
  const query = useOptionsChain(product, expiration, scope);
  const displayData = query.data ?? model.data;
  const switching = expiration !== undefined && query.data === undefined && query.isPending;

  // 05 下钻联动消费（第三十四轮 B5）：过期/已处理/找不到到期三种情况都不动
  useEffect(() => {
    const live = liveFocus(focus);
    if (!live?.expiry || live.at === focusHandledAtRef.current) return;
    focusHandledAtRef.current = live.at;
    const serie = displayData?.series.find((item) => item.expiration === live.expiry);
    if (!serie) return;
    setChainExpiration(panelId, serie.expiration);
    setSelectedStrike(null);
    setFlashExpiry(serie.expiration);
    const timer = setTimeout(() => setFlashExpiry(null), 2000);
    return () => clearTimeout(timer);
  }, [focus, displayData, panelId, setChainExpiration]);

  const rowsAsc = useMemo(
    () => [...(displayData?.chain?.rows ?? [])].sort((a, b) => a.strike - b.strike),
    [displayData],
  );
  const marks = useMemo(
    () => (displayData?.chain ? buildChainMarks(rowsAsc, displayData.chain) : new Map<number, ChainMark[]>()),
    [displayData, rowsAsc],
  );
  const visibleAsc = useMemo(() => {
    if (!displayData?.chain) return [];
    if (showAll) return rowsAsc;
    return sliceAtmWindow(
      rowsAsc,
      displayData.chain.underlying_price,
      displayData.chain.expected_move_lower,
      displayData.chain.expected_move_upper,
    );
  }, [displayData, rowsAsc, showAll]);
  const visible = useMemo(() => sortChainRows(visibleAsc, sort), [visibleAsc, sort]);
  // 追踪标的价居中（共享 hook use-spot-follow）：开启后保持距标的价最近的执行价行垂直居中，手动滚动即关闭
  const spotFollow = useSpotFollow<HTMLDivElement>();
  // 追踪开启期间，标的价/可见行变化 → 行 DOM 重建后即时保持居中（查询在 hook 的 rAF 内进行）
  useEffect(() => {
    if (spotFollow.follow) spotFollow.keepSpotCentered();
  }, [spotFollow.follow, displayData?.chain?.underlying_price, visible, spotFollow.keepSpotCentered]);

  const maxAbsGex = Math.max(
    1e-9,
    ...visible.flatMap((row) => [Math.abs(row.call?.gex ?? 0), Math.abs(row.put?.gex ?? 0)]),
  );

  // 可见窗口内分侧统计：OI/VOL 最大值（微条归一）、IV min/max（色阶归一，回退档不参与）
  const sideStats = useMemo(() => {
    const stats = {
      callOi: 0,
      callVol: 0,
      putOi: 0,
      putVol: 0,
      callIv: null as { min: number; max: number } | null,
      putIv: null as { min: number; max: number } | null,
    };
    let callIvMin = Number.POSITIVE_INFINITY;
    let callIvMax = Number.NEGATIVE_INFINITY;
    let putIvMin = Number.POSITIVE_INFINITY;
    let putIvMax = Number.NEGATIVE_INFINITY;
    for (const row of visible) {
      const { call, put } = row;
      if (call) {
        stats.callOi = Math.max(stats.callOi, call.oi ?? 0);
        stats.callVol = Math.max(stats.callVol, call.volume ?? 0);
        if (call.iv != null && !call.iv_fallback) {
          callIvMin = Math.min(callIvMin, call.iv);
          callIvMax = Math.max(callIvMax, call.iv);
        }
      }
      if (put) {
        stats.putOi = Math.max(stats.putOi, put.oi ?? 0);
        stats.putVol = Math.max(stats.putVol, put.volume ?? 0);
        if (put.iv != null && !put.iv_fallback) {
          putIvMin = Math.min(putIvMin, put.iv);
          putIvMax = Math.max(putIvMax, put.iv);
        }
      }
    }
    if (callIvMin <= callIvMax) stats.callIv = { min: callIvMin, max: callIvMax };
    if (putIvMin <= putIvMax) stats.putIv = { min: putIvMin, max: putIvMax };
    return stats;
  }, [visible]);

  // Spot / Flip / Expected Move ±1σ 线只在行权价序绘制（其他排序下纵向位置无价格含义）
  const levelLines = useMemo(() => {
    if (!displayData?.chain || sort !== "strike") return [];
    const lines: Array<{ kind: "spot" | "flip" | "emUpper" | "emLower"; value: number }> = [
      { kind: "spot", value: displayData.chain.underlying_price },
    ];
    if (displayData.chain.gamma_flip !== null) {
      lines.push({ kind: "flip", value: displayData.chain.gamma_flip });
    }
    if (displayData.chain.expected_move_upper !== null) {
      lines.push({ kind: "emUpper", value: displayData.chain.expected_move_upper });
    }
    if (displayData.chain.expected_move_lower !== null) {
      lines.push({ kind: "emLower", value: displayData.chain.expected_move_lower });
    }
    return lines;
  }, [displayData, sort]);

  const selectedRow =
    selectedStrike === null
      ? null
      : (displayData?.chain?.rows.find((row) => row.strike === selectedStrike) ?? null);

  // 空态：无快照 / 加载中 / 请求失败 / close 档——不展示模拟数据
  if (!displayData?.chain) {
    if (displayData && displayData.has_data === false && scope === "close") {
      return (
        <div className="grid min-h-[320px] place-items-center bg-[var(--ms-plot-bg)] px-4 py-10 text-center">
          <div>
            <p className="text-sm text-[var(--ms-text-secondary)]">暂无完整的收盘数据</p>
            <p className="mt-1 font-mono text-[9px] tracking-[0.1em] text-[var(--ms-text-tertiary)]">
              每日一次结算真值 · 全天冻结 · 不展示模拟数据
            </p>
          </div>
        </div>
      );
    }
    const status =
      query.error instanceof OptionsApiError ? query.error.status : undefined;
    return (
      <div className="grid min-h-[320px] place-items-center bg-[var(--ms-plot-bg)] px-4 py-10 text-center">
        <div>
          {query.isPending ? (
            <p className="text-sm text-[var(--ms-text-secondary)]">正在请求期权链数据…</p>
          ) : (
            <>
              <p className="text-sm text-[var(--ms-text-secondary)]">
                {dataAvailabilityMessage(displayData?.missing_reason, status ? "期权链数据加载失败" : "当前暂无期权链数据")}
              </p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.1em] text-[var(--ms-text-tertiary)]">
                不展示模拟买卖报价
              </p>
              {status && status !== 404 ? (
                <button
                  type="button"
                  onClick={() => void query.refetch()}
                  className="ms-control mt-4 px-3 py-1.5 text-[11px] text-[var(--ms-text-primary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
                >
                  重试
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  const chain = displayData.chain;
  const activeExpiration = expiration ?? chain.expiration;
  const selectedMarks = selectedRow ? (marks.get(selectedRow.strike) ?? []) : [];
  // 追踪目标行 = 距标的价（underlying_price）最近的执行价行，渲染时打 [data-spot-row] 标记
  const spotRowStrike = visible.reduce<number | undefined>(
    (best, row) =>
      best === undefined || Math.abs(row.strike - chain.underlying_price) < Math.abs(best - chain.underlying_price)
        ? row.strike
        : best,
    undefined,
  );

  return (
    <div ref={measureRef} className="bg-[var(--ms-plot-bg)] px-3 py-3">
      {/* 到期切换器：label + DTE，切换即按 expiration 重新请求（到期维度 ≠ 周期 scope，周期统一顶栏总控） */}
      <div className="flex gap-1 overflow-x-auto pb-1" aria-label="切换到期">
        {displayData.series.map((serie) => {
          const on = serie.expiration === activeExpiration;
          return (
            <button
              key={serie.expiration}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setChainExpiration(panelId, serie.expiration);
                setSelectedStrike(null);
              }}
              className={`shrink-0 rounded-[9px] border px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                on
                  ? "border-[var(--ms-brand)] bg-[var(--ms-brand)] text-black"
                  : "border-[var(--ms-separator)] text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
              } ${flashExpiry === serie.expiration ? "ring-2 ring-[var(--ms-brand)]" : ""}`}
            >
              {sanitizeUserFacingText(serie.label) || serie.kind} · {serie.days_to_expiration}D
            </button>
          );
        })}
      </div>

      {/* 排序 + ATM 窗口：到期、标的、乘数等冗长说明已由到期 tabs 和表格内容承载。 */}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <div className="ms-control flex p-0.5" aria-label="排序方式">
            {CHAIN_SORT_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={sort === tab.value}
                onClick={() => setSort(tab.value)}
                className={`h-7 rounded-[7px] px-2.5 text-[11px] font-semibold transition-colors ${
                  sort === tab.value
                    ? "bg-[var(--ms-brand)] text-black"
                    : "text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={showAll}
            onClick={() => setShowAll((value) => !value)}
            className={`h-8 rounded-[9px] border px-2.5 text-[11px] font-semibold transition-colors ${
              showAll
                ? "border-[var(--ms-brand)] bg-[var(--ms-brand)] text-black"
                : "border-[var(--ms-separator)] text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)]"
            }`}
          >
            {showAll ? `全部 ${rowsAsc.length} 档` : "ATM 窗口"}
          </button>
          {/* 追踪标的价居中开关（共享 spot-follow-button）：激活态同面板 chip 选中口径 */}
          <SpotFollowButton follow={spotFollow.follow} onToggle={spotFollow.toggleFollow} />
        </div>
      </div>

      {/* 镜像表：左 Call（绿）｜ Strike 中轴 ｜右 Put（红）；列 LOD：窄窗按 CHAIN_LOD_TIERS 从外到内砍列，不截断不压缩 */}
      {/* setRootEl 挂表格容器：滚动由外层 DockPanelBody 承载（内容纵向滚动型例外口径），hook 向上解析实际滚动容器 */}
      <div ref={spotFollow.setRootEl} className={`mt-2 transition-opacity ${switching ? "opacity-40" : ""}`}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--ms-separator)] font-mono text-[13px] font-bold tracking-[0.14em]">
              <th colSpan={sideColCount} className="py-1 text-center text-[var(--ms-buy-bright)]">CALL</th>
              <th className="py-1 text-center text-[var(--ms-text-secondary)]">STRIKE</th>
              <th colSpan={sideColCount} className="py-1 text-center text-[var(--ms-sell-bright)]">PUT</th>
            </tr>
            <tr className="border-b-2 border-[var(--ms-separator)] font-mono text-[12px] font-semibold text-[var(--ms-text-primary)]">
              {SIDE_HEADERS.filter((h) => !hiddenCols.has(h.key)).map((h) => (
                <th key={`c-${h.key}`} className="px-1 pb-1 text-right" title={settlement && h.key === "last" ? "官方结算价" : h.title}>
                  {settlement && h.key === "last" ? "SETTLE" : h.label}
                </th>
              ))}
              <th className="px-1 pb-1 text-center" title="行权价：期权合约约定的执行价格">K</th>
              {SIDE_HEADERS.filter((h) => !hiddenCols.has(h.key)).reverse().map((h) => (
                <th key={`p-${h.key}`} className="px-1 pb-1 text-right" title={settlement && h.key === "last" ? "官方结算价" : h.title}>
                  {settlement && h.key === "last" ? "SETTLE" : h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const next = visible[index + 1];
              // 降序行序列中，线落在 value <= 本行 且 value > 下一行 的缝隙
              const before = index === 0 ? levelLines.filter((line) => line.value > row.strike) : [];
              const between = levelLines.filter(
                (line) => line.value <= row.strike && (next === undefined || line.value > next.strike),
              );
              const rowMarks = marks.get(row.strike) ?? [];
              const orderedMarks = MARK_ORDER.filter((mark) => rowMarks.includes(mark));
              const isAtm = rowMarks.includes("atm");
              const isSelected = selectedStrike === row.strike;
              const dimmed = selectedStrike !== null && !isSelected;
              const boxColor = boxColorOf(rowMarks);
              const callGex = Math.abs(row.call?.gex ?? 0);
              const putGex = Math.abs(row.put?.gex ?? 0);
              // 墙行整行淡色底（绿=CW / 红=PW），15% 不透明度保证暗色主题下一眼定位
              const wallTint =
                !isSelected && !isAtm
                  ? rowMarks.includes("callWall")
                    ? "color-mix(in srgb, var(--ms-success) 15%, transparent)"
                    : rowMarks.includes("putWall")
                      ? "color-mix(in srgb, var(--ms-danger) 15%, transparent)"
                      : undefined
                  : undefined;

              return (
                <Fragment key={row.strike}>
                  {before.map((line) => (
                    <LevelLineRow
                      key={`${line.kind}-top`}
                      kind={line.kind}
                      value={line.value}
                      tickSize={tickSize}
                      flip={displayData?.chain?.gamma_flip ?? null}
                      colSpan={sideColCount * 2 + 1}
                    />
                  ))}
                  <tr
                    onClick={() => setSelectedStrike(isSelected ? null : row.strike)}
                    aria-pressed={isSelected}
                    data-spot-row={row.strike === spotRowStrike ? true : undefined}
                    style={wallTint ? { background: wallTint } : undefined}
                    className={`cursor-pointer border-b border-[var(--ms-separator)] transition-colors hover:bg-[var(--ms-card-bg)] ${
                      isAtm || isSelected ? "bg-[var(--ms-brand-dim)]" : ""
                    } ${dimmed ? "opacity-40" : ""}`}
                  >
                    <SideCells
                      side={row.call}
                      tone="call"
                      tickSize={tickSize}
                      itm={row.strike < chain.underlying_price}
                      oiMax={sideStats.callOi}
                      volMax={sideStats.callVol}
                      ivRange={sideStats.callIv}
                      hidden={hiddenCols}
                    />
                    <td className="px-1 py-1 text-center">
                      <div
                        className="mx-auto w-fit rounded-sm px-1.5 py-0.5"
                        style={boxColor ? { boxShadow: `inset 0 0 0 1.5px ${boxColor}` } : undefined}
                      >
                        <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--ms-text-primary)]">
                          {formatPrice(row.strike, tickSize)}
                        </span>
                      </div>
                      {/* GEX 对照微条：左绿 = Call，右红 = Put */}
                      <div className="mx-auto mt-0.5 flex h-1 w-20 max-w-full items-center gap-px" title={`Call GEX ${formatNotional(row.call?.gex ?? 0)} · Put GEX ${formatNotional(row.put?.gex ?? 0)}`}>
                        <span className="flex h-full flex-1 justify-end overflow-hidden rounded-l-[2px] bg-[var(--ms-card-bg)]">
                          <span className="block h-full bg-[var(--ms-chart-buy)]" style={{ width: `${(callGex / maxAbsGex) * 100}%` }} />
                        </span>
                        <span className="flex h-full flex-1 overflow-hidden rounded-r-[2px] bg-[var(--ms-card-bg)]">
                          <span className="block h-full bg-[var(--ms-chart-sell)]" style={{ width: `${(putGex / maxAbsGex) * 100}%` }} />
                        </span>
                      </div>
                      {orderedMarks.length > 0 ? (
                        <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                          {orderedMarks.map((mark) => (
                            <span
                              key={mark}
                              className={`rounded-sm border px-1.5 font-mono text-[9px] font-semibold leading-[15px] ${MARK_STYLE[mark].className}`}
                            >
                              {MARK_STYLE[mark].label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <SideCells
                      side={row.put}
                      tone="put"
                      tickSize={tickSize}
                      mirror
                      itm={row.strike > chain.underlying_price}
                      oiMax={sideStats.putOi}
                      volMax={sideStats.putVol}
                      ivRange={sideStats.putIv}
                      hidden={hiddenCols}
                    />
                  </tr>
                  {between.map((line) => (
                    <LevelLineRow
                      key={`${line.kind}-${row.strike}`}
                      kind={line.kind}
                      value={line.value}
                      tickSize={tickSize}
                      flip={displayData?.chain?.gamma_flip ?? null}
                      colSpan={sideColCount * 2 + 1}
                    />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--ms-text-secondary)]">
            当前快照该到期没有可用档位
          </p>
        ) : null}
      </div>

      {/* 行点击下钻：同一行摊开全字段，再点收起 */}
      {selectedRow ? (
        <div className="mt-3 rounded-lg border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-sm font-semibold tabular-nums text-[var(--ms-text-primary)]">
                {formatPrice(selectedRow.strike, tickSize)}
              </span>
              {MARK_ORDER.filter((mark) => selectedMarks.includes(mark)).map((mark) => (
                <span
                  key={mark}
                  className={`rounded-sm border px-1.5 font-mono text-[9px] font-semibold leading-4 ${MARK_STYLE[mark].className}`}
                >
                  {MARK_STYLE[mark].label}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSelectedStrike(null)}
              aria-label="收起明细"
              className="ms-control grid size-6 place-items-center text-[11px] text-[var(--ms-text-secondary)] transition-colors hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)]"
            >
              ×
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SideDetail title="CALL" side={selectedRow.call} tone="call" tickSize={tickSize} strike={selectedRow.strike} settlement={settlement} />
            <SideDetail title="PUT" side={selectedRow.put} tone="put" tickSize={tickSize} strike={selectedRow.strike} settlement={settlement} />
          </div>
        </div>
      ) : null}

      {/* 图例 + 脚注 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--ms-separator)] pt-2 font-mono text-[8px] text-[var(--ms-text-tertiary)]">
        <span>灰显 IV = ATM 回退值</span>
        <span>淡绿/淡红底 = ITM 实值区</span>
        <span>IV 色阶：蓝 = 低 IV · 红 = 高 IV</span>
        <span>OI/VOL 格内微条 = 窗口内相对大小</span>
        <span>绿框 CALL WALL · 红框 PUT WALL · 蓝 MAX Γ · 灰 MAX PAIN</span>
        <span>中轴微条 = 该档 Call / Put GEX</span>
        <span>灰虚线 ±1σ = Expected Move 边界</span>
        <span className="ml-auto">点行下钻 · 再点收起</span>
      </div>
    </div>
  );
}
