/**
 * 06 图区外围框架：横向四栏，单一几何真源。
 *
 *   [ A 图区 ][ B 价格 ][ C 标记 ][ D VP? ]
 *
 * 间距节奏（一律固定 px，不随缩放）：
 *   A|B  4px   K 线右缘 → 数字左缘
 *   B|C  6px   数字右缘 → 标记左缘（价格与标记成对）
 *   墙线 4px   接到标记左缘前
 *   C|D  2px   最长标记 → VP
 *
 * 标记左对齐（所有 chip 同一左缘），避免右对齐造成墙线长短不一。
 */

export const PAD_L = 8;
export const PAD_T = 10;
export const PAD_B = 20;
export const VOL_H = 52;
export const VOL_GAP = 8;
/** B 栏：4px 左缝 + 9 字符价 ≈50 + 2px 右缝 */
export const TICK_COL_W = 56;
export const VP_DEFAULT_W = 110;
export const VP_MIN_W = 60;
export const VP_MAX_W = 240;
export const BADGE_W = 170;
/** 数字右缘 → 标记左缘 */
export const GAP_AXIS_MARK = 6;
/** 最长标记 → VP */
export const GAP_MARK_VP = 2;
/** 墙线终点 → 标记左缘 */
export const GAP_WALL_MARK = 4;
const PLOT_MIN = 80;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type IntradayFrame = {
  width: number;
  height: number;
  /** A 左缘（含左 pad） */
  plotLeft: number;
  /** A 右缘 = B 左缘。K 线 x 映射停在这里 */
  plotRight: number;
  plotW: number;
  /** B 右缘 */
  yAxisRight: number;
  tickCol: number;
  /** B 栏数字居中 x */
  tickX: number;
  /** C 标记左对齐 x */
  markLeft: number;
  /** 墙/Flip 横线终点 = 图区右缘，不进 Y 轴 */
  wallEndX: number;
  /** C 右缘（VP 开 = VP 左缘，关 = width-2） */
  badgeRight: number;
  badgeCol: number;
  badgeMaxW: number;
  vpOn: boolean;
  vpLeft: number;
  vpWidth: number;
  mainTop: number;
  mainBottom: number;
  mainH: number;
  volTop: number;
  volBottom: number;
};

export function layoutIntradayFrame(input: {
  width: number;
  height: number;
  vpOn: boolean;
  vpW?: number;
  /** 最宽标记（仅名字）宽，0 = 无 C 列 */
  badgeInnerW: number;
}): IntradayFrame {
  const width = Math.max(0, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  const vpOn = input.vpOn;
  const vpWidth = vpOn ? clamp(Math.round(input.vpW ?? VP_DEFAULT_W), VP_MIN_W, VP_MAX_W) : 0;
  const vpLeft = width - vpWidth;
  const badgeRight = vpOn ? vpLeft : Math.max(0, width - 2);

  let badgeCol =
    input.badgeInnerW > 0
      ? Math.min(Math.ceil(input.badgeInnerW), BADGE_W) + GAP_AXIS_MARK + GAP_MARK_VP
      : 0;
  let tickCol = TICK_COL_W;

  const plotLeft = PAD_L;
  let plotRight = badgeRight - badgeCol - tickCol;
  if (plotRight - plotLeft < PLOT_MIN) {
    const need = PLOT_MIN - (plotRight - plotLeft);
    const fromBadge = Math.min(need, badgeCol);
    badgeCol -= fromBadge;
    plotRight += fromBadge;
    const still = PLOT_MIN - (plotRight - plotLeft);
    if (still > 0) {
      const fromTick = Math.min(still, Math.max(0, tickCol - 28));
      tickCol -= fromTick;
      plotRight += fromTick;
    }
  }
  if (plotRight < plotLeft) plotRight = plotLeft;

  const yAxisRight = plotRight + tickCol;
  const markLeft = yAxisRight + GAP_AXIS_MARK;
  const wallEndX = plotRight;
  const badgeMaxW = Math.max(0, badgeRight - markLeft);
  const mainTop = PAD_T;
  const mainBottom = height - PAD_B - VOL_H - VOL_GAP;
  const volTop = mainBottom + VOL_GAP;
  const volBottom = volTop + VOL_H;

  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotW: Math.max(1, plotRight - plotLeft),
    yAxisRight,
    tickCol,
    tickX: plotRight + tickCol / 2,
    markLeft,
    wallEndX,
    badgeRight,
    badgeCol,
    badgeMaxW,
    vpOn,
    vpLeft,
    vpWidth,
    mainTop,
    mainBottom,
    mainH: mainBottom - mainTop,
    volTop,
    volBottom,
  };
}

export function frameOk(f: IntradayFrame): boolean {
  return f.width > 0 && f.height > 0 && f.plotW > 0 && f.mainH > 0;
}
