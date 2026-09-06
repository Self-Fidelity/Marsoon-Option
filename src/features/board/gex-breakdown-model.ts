import { optionProductConfig, type OptionProduct, type OptionScope } from "@/api/options";

import type { DashboardViewModel, GammaRow } from "../options/dashboard-view-model";

/**
 * 08 Call/Put GEX 拆分面板的输入契约。
 * 面板只认这个结构，不依赖 dashboard 页面状态——后续 /board 拼装布局复用。
 */
export interface GexBreakdownModel {
  rows: GammaRow[];
  spot?: number;
  callWall?: number;
  putWall?: number;
  gammaFlip?: number;
  tickSize: number;
  scope: string;
  /** 数据版本（快照 capturedAt 秒级）；06 内嵌 VP 条带聚合 memo key 用（第二十轮） */
  snapshotUnix: number;
}

export function profileP95(values: number[]): number {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!nums.length) return 1;
  const index = Math.min(nums.length - 1, Math.max(0, Math.ceil(nums.length * 0.95) - 1));
  return Math.max(nums[index] ?? 1, 1e-9);
}

export function buildGexBreakdownModel(
  viewModel: DashboardViewModel,
): GexBreakdownModel {
  return {
    rows: viewModel.gammaRows,
    spot: viewModel.spot,
    callWall: viewModel.callWall,
    putWall: viewModel.putWall,
    gammaFlip: viewModel.gammaFlip,
    tickSize: viewModel.tickSize,
    scope: viewModel.scope,
    snapshotUnix: viewModel.snapshotUnix,
  };
}

const DEBUG_STEP: Record<OptionProduct, number> = { NQ: 25, ES: 10, GC: 5 };
const DEBUG_SPOT: Record<OptionProduct, number> = { NQ: 29600, ES: 6700, GC: 2650 };

/**
 * 调试用 GEX 剖面（非实时）。围绕 spot 生成看涨/看跌墙与 Flip，
 * 保证与 06 当前价区有交叠，条带能画出来。
 */
export function buildDebugGexBreakdownModel(
  product: OptionProduct,
  scope: OptionScope,
  spot?: number,
): GexBreakdownModel {
  const step = DEBUG_STEP[product];
  const tickSize = optionProductConfig[product].tickSize;
  const center = Math.round((spot ?? DEBUG_SPOT[product]) / step) * step;
  const callWall = center + step * 4;
  const putWall = center - step * 8;
  const gammaFlip = center - step * 2;
  const rows: GammaRow[] = [];
  for (let i = -48; i <= 48; i++) {
    const strike = center + i * step;
    const dCall = (strike - callWall) / (step * 6);
    const dPut = (strike - putWall) / (step * 6);
    const callGEX = 3.2e8 * Math.exp(-dCall * dCall);
    const putGEX = -2.8e8 * Math.exp(-dPut * dPut);
    rows.push({
      strike,
      callGEX,
      putGEX,
      netGEX: callGEX + putGEX,
      grossGEX: Math.abs(callGEX) + Math.abs(putGEX),
      callOI: 0,
      putOI: 0,
      callVol: 0,
      putVol: 0,
      qualityFlags: 0,
    });
  }
  return {
    rows,
    spot: center,
    callWall,
    putWall,
    gammaFlip,
    tickSize,
    scope,
    snapshotUnix: Math.floor(Date.now() / 1000),
  };
}
