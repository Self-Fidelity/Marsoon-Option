import type { OptionProduct } from "@/api/options";

import type { DashboardViewModel, GammaRow } from "../options/dashboard-view-model";

/**
 * 06 内嵌 VP 条带的输入契约（原 08 Call/Put GEX 拆分面板契约，面板已删）。
 * 面板只认这个结构，不依赖 dashboard 页面状态——后续 /board 拼装布局复用。
 */
export interface GexBreakdownModel {
  product: OptionProduct;
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
    product: viewModel.product,
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
