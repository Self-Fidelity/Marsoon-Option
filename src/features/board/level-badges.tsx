"use client";

import type { OptionScope } from "@/api/options";
import { formatPrice } from "@/lib/formatters";

/**
 * 关键位徽标层（06 日内面板右轴 gutter 用，08 面板联动预留）。
 * 数据模型经纯函数 selector 输出，渲染为独立组件；两面板将来从同一份模型取数，
 * changedAt 变化触发共用脉冲动画（本轮仅有接口，不实现联动）。
 */

export type LevelBadgeKind = "CW" | "PW" | "FLIP" | "SPOT";

/** 徽标数据模型（selector 输出；changedAt 预留，当前数据源无变更时点恒 null） */
export interface LevelBadgeModel {
  key: string;
  price: number;
  /** 合并组成员 scope（未合并 = 单元素），按 SCOPE_MERGE_ORDER 固定排序 */
  members: OptionScope[];
  kind: LevelBadgeKind;
  /** chip 单行名字段（周期前缀全写清，如 "0D+90+RTH·PW"；SPOT 无前缀） */
  name: string;
  /** 数值段（如 "29,500.00"） */
  value: string;
  /** 语义色（accent 竖条 / 数值段文字 / SPOT 纯文字） */
  fill: string;
  /** plain 变体（SPOT）：无 accent 竖条的灰底牌，价格行 + 倒计时行（第十七轮徽标化；此前为纯文字） */
  plain: boolean;
  changedAt: number | null;
}

/** selector 输入：已跨周期同价合并后的墙线（构造在消费方，避免口径散落） */
export interface LevelBadgeLine {
  members: OptionScope[];
  short: string;
  value: number | null;
  color: string;
  primary: boolean;
}

/** 布局后的徽标：带最终中心 y（垂直推开已应用） */
export interface LaidOutBadge extends LevelBadgeModel {
  y: number;
}

/** 名字行周期前缀：scope → 前缀。close 档恒空态，仅作类型兜底 */
export const SCOPE_PREFIX: Record<OptionScope, string> = {
  close: "CL",
  "0dte": "0D",
  d30: "30",
  d90: "90",
};

export const badgePrefix = (members: OptionScope[]) =>
  members.map((s) => SCOPE_PREFIX[s]).join("+");

/**
 * chip 单行名字（第二十九轮轴上单行 chip 化）：周期前缀全部写清楚，不做压缩缩写（用户红线：
 * 合并组也直接写 "0D+90+RTH·PW"，不用 "3Σ" 之类代号——徽标是期权交易最关键信息，可读性优先于省空间）。
 */
export const badgeName = (members: OptionScope[], short: string) =>
  `${badgePrefix(members)}·${short}`;

/** 徽标一句话解释（hover tooltip 用，第二十九轮；面向小白，一句说清"这是什么、有什么用"） */
export const LEVEL_BADGE_EXPLAIN: Record<LevelBadgeKind, string> = {
  CW: "看涨墙（Call Wall）：看涨期权持仓最集中的价位，价格涨近这里常遇到阻力。",
  PW: "看跌墙（Put Wall）：看跌期权持仓最集中的价位，价格跌近这里常获得支撑。",
  FLIP: "Gamma 翻转位：价格穿过它，做市商的对冲方向会反转，行情波动往往会放大。",
  SPOT: "现货最新价；下方小字是距下次数据更新的倒计时。",
};

/** 周期前缀释义（tooltip 追加，帮小白读名字，如 "0D+90·PW"） */
export const SCOPE_PREFIX_EXPLAIN =
  "前缀=统计周期：0D=当天到期，30=30天内到期，90=90天内到期，RTH=全部期限；多个前缀表示这些周期算出的同一价位。";

/**
 * 徽标 selector：过滤（域内、非主周期只出 FLIP）→ 跨语义位同价（±1 tick）聚类跳过
 * → 按 y 排序垂直推开（顶部下压、底部回推，整体保持在 [top, bottom] 内）。
 * 纯函数，无 React 依赖；y 映射与字号度量由调用方注入。
 */
export function selectLevelBadges(
  lines: LevelBadgeLine[],
  opts: {
    lo: number;
    hi: number;
    tickSize: number;
    y: (v: number) => number;
    /** 可布局区间顶/底（主图区） */
    top: number;
    bottom: number;
    /** 牌高（垂直推开步长） */
    badgeH: number;
  },
): LaidOutBadge[] {
  const { lo, hi, tickSize, y, top, bottom, badgeH } = opts;
  const badges: LaidOutBadge[] = [];
  const claimed: number[] = [];
  for (const line of lines) {
    if (line.value === null || line.value < lo || line.value > hi) continue;
    if (!line.primary && line.short !== "FLIP") continue;
    const kind = line.short as LevelBadgeKind;
    // 同价聚类：与已占位价格差 ≤1 tick 时跳过（主周期优先，因主周期排在 lines 前段）
    if (claimed.some((v) => Math.abs(v - line.value!) <= tickSize)) continue;
    claimed.push(line.value);
    badges.push({
      key: `${line.members.join("+")}-${line.short}`,
      price: line.value,
      members: line.members,
      kind,
      name: kind === "SPOT" ? "SPOT" : badgeName(line.members, line.short),
      value: formatPrice(line.value, tickSize),
      y: y(line.value),
      fill: line.color,
      plain: kind === "SPOT",
      changedAt: null,
    });
  }
  badges.sort((a, b) => a.y - b.y);
  // 垂直推开按每牌实际半高（SPOT 两行牌半高 13，关键位徽标半高 = badgeH/2（第二十九轮单行化 30 → 20，半高 10）自动跟随）
  const halfOf = (b: LaidOutBadge) => (b.plain ? SPOT_BADGE_H / 2 : badgeH / 2);
  let prevBottom = top;
  for (const badge of badges) {
    if (badge.y < prevBottom + halfOf(badge)) badge.y = prevBottom + halfOf(badge);
    prevBottom = badge.y + halfOf(badge);
  }
  // 底部超界时从下往上回推，保持整体在主图区内
  for (let i = badges.length - 1; i >= 0; i--) {
    const below = i === badges.length - 1 ? bottom : badges[i + 1]!.y - halfOf(badges[i + 1]!);
    const limit = below - halfOf(badges[i]!);
    if (badges[i]!.y > limit) badges[i]!.y = limit;
  }
  return badges;
}

/** 单行 chip 牌高（第二十九轮轴上单行化：两行 30 → 单行 20，半高 10；垂直推开步长随动，拥挤度下降；
 *  历史：第二十五轮名字行再放大 28 → 30，第二十四轮可读性优先 24 → 28，第二十八轮 1B 22 → 24，第二十二轮 20 → 22，第十五轮终端风改版 22 → 20） */
export const LEVEL_BADGE_H = 20;

/** SPOT 牌高（8.5px 价格行 + 8px 倒计时行 + 上下内边距，半高 13；第十七轮 SPOT 徽标化新增，第二十八轮字号随抬档） */
export const SPOT_BADGE_H = 26;

/** 牌左侧语义色 accent 竖条宽 */
export const LEVEL_BADGE_ACCENT_W = 3;

/**
 * 关键位徽标（第二十九轮：挪入 Y 轴刻度列、两行牌 → 单行紧凑 chip，TradingView 式轴上价签）：
 * 直角深底单行牌：3px accent 竖条 + 名字段 9px/700 亮灰 + 数值段 10px/700 等宽语义色同行；
 * 周期前缀全写清（"0D+90+RTH·PW"），合并组不缩写；hover tooltip 给一句话白话解释（LEVEL_BADGE_EXPLAIN + 周期前缀释义）；
 * 牌底 var(--ms-panel-bg) 完全不透明，压刻度/网格仍可读；
 * 徽标是期权交易最关键信息，不参与任何 LOD/缩放/字形压缩（用户红线，第二十九轮明确）。
 */
/** 徽标牌宽公式（第二十九轮单行：名字 9px mono ≈ 5.4/char + 间距 3 + 数值 10px mono ≈ 6.0/char + accent 3 + 左右内边距 2+2，上限 maxWidth 仅防失控）。
 *  常规 `0D·FLIP 29,474.07` ≈ 104px；三周期合并 `0D+90+RTH·FLIP …` ≈ 129px；四周期 ≈ 156px（超出 gutter 时左缘探入蜡烛区边缘，牌底不透明仍可读）。
 *  抽出共享（第二十一轮）：调用方需按"牌右缘锚定"反推左缘 x 时，先算牌宽再定位。 */
export function levelBadgeWidth(name: string, value: string, maxWidth: number): number {
  return Math.min(
    maxWidth,
    name.length * 5.4 + 3 + value.length * 6.0 + LEVEL_BADGE_ACCENT_W + 4,
  );
}

/** 仅标记（名字+accent，价格在 Y 轴）：`0D+90·PW` ≈ 58px */
export function levelBadgeMarkWidth(name: string, maxWidth: number): number {
  return Math.min(maxWidth, name.length * 5.4 + LEVEL_BADGE_ACCENT_W + 4);
}

export function LevelAxisBadge({
  badge,
  x,
  maxWidth,
  markOnly = false,
}: {
  badge: LaidOutBadge;
  x: number;
  maxWidth: number;
  /** true：只画标记，价格由调用方画在 Y 轴 */
  markOnly?: boolean;
}) {
  const w = markOnly
    ? levelBadgeMarkWidth(badge.name, maxWidth)
    : levelBadgeWidth(badge.name, badge.value, maxWidth);
  const textX = x + LEVEL_BADGE_ACCENT_W + 2;
  return (
    <g>
      <title>{`${badge.name} ${badge.value} — ${LEVEL_BADGE_EXPLAIN[badge.kind]}${SCOPE_PREFIX_EXPLAIN}`}</title>
      <rect
        x={x}
        y={badge.y - LEVEL_BADGE_H / 2}
        width={w}
        height={LEVEL_BADGE_H}
        fill="var(--ms-panel-bg)"
        opacity={1}
      />
      <rect
        x={x}
        y={badge.y - LEVEL_BADGE_H / 2}
        width={LEVEL_BADGE_ACCENT_W}
        height={LEVEL_BADGE_H}
        fill={badge.fill}
      />
      <text x={textX} y={badge.y + 3.5} fontFamily="monospace" style={{ fontVariantNumeric: "tabular-nums" }}>
        <tspan fontSize={9} fontWeight={700} fill="var(--ms-text-primary)">
          {badge.name}
        </tspan>
        {markOnly ? null : (
          <tspan dx={3} fontSize={10} fontWeight={700} fill={badge.fill}>
            {badge.value}
          </tspan>
        )}
      </text>
    </g>
  );
}
