import type { DashboardViewModel, GammaRegime } from "../options/dashboard-view-model";

/**
 * 01 总览面板的输入契约：快照级关键指标 + 结构价位 + 底部 GEX/OI/VOL 分布。
 * 全部为 dashboard ViewModel 已有字段的透传，缺失保持 undefined（不降级为 0）。
 */
export interface OverviewProfileBar {
  strike: number;
  /** net GEX（正=call 侧主导绿条，负=put 侧红条） */
  gex: number;
  oi: number;
  vol: number;
  callOI?: number;
  putOI?: number;
  callGex: number;
  putGex: number;
  netDelta?: number;
  netCharm?: number;
}

export interface OverviewModel {
  regime: GammaRegime;
  netGEX?: number;
  spot?: number;
  callWall?: number;
  putWall?: number;
  gammaFlip?: number;
  keyGammaStrike?: number;
  expectedMoveUpper?: number;
  expectedMoveLower?: number;
  atmIV?: number;
  putCallOIRatio?: number;
  zeroDTEGrossGEXShare?: number;
  /** 全执行价剖面，升序（左低右高）；图上可拖拽平移、滚轮缩放 */
  profile: OverviewProfileBar[];
  tickSize: number;
  scope: string;
}

export function buildOverviewModel(viewModel: DashboardViewModel): OverviewModel {
  const profile = (viewModel.allGammaRows.length ? viewModel.allGammaRows : viewModel.gammaRows)
    .map((row) => ({
      strike: row.strike,
      gex: row.netGEX,
      oi: row.callOI + row.putOI,
      vol: row.callVol + row.putVol,
      callOI: row.callOI,
      putOI: row.putOI,
      callGex: row.callGEX,
      putGex: row.putGEX,
      netDelta: row.netDelta,
      netCharm: row.netCharm,
    }))
    .sort((a, b) => a.strike - b.strike);

  return {
    regime: viewModel.regime,
    netGEX: viewModel.netGEX,
    spot: viewModel.spot,
    callWall: viewModel.callWall,
    putWall: viewModel.putWall,
    gammaFlip: viewModel.gammaFlip,
    keyGammaStrike: viewModel.keyGammaStrike,
    expectedMoveUpper: viewModel.expectedMoveUpper,
    expectedMoveLower: viewModel.expectedMoveLower,
    atmIV: viewModel.atmIV,
    putCallOIRatio: viewModel.putCallOIRatio,
    zeroDTEGrossGEXShare: viewModel.zeroDTEGrossGEXShare,
    profile,
    tickSize: viewModel.tickSize,
    scope: viewModel.scope,
  };
}
