import type { DashboardViewModel } from "../options/dashboard-view-model";

/**
 * 06 底部 Exposure 剖面副图的输入契约：全执行价 OI/GEX/DEX/CHEX 剖面 + 结构价位。
 * 全部为 dashboard ViewModel 已有字段的透传，缺失保持 undefined（不降级为 0）。
 */
export interface ExposureProfileBar {
  strike: number;
  callOI?: number;
  putOI?: number;
  callGex: number;
  putGex: number;
  netDelta?: number;
  netCharm?: number;
}

export interface ExposureProfileModel {
  /** 全执行价剖面，升序（左低右高）；图上可拖拽平移、滚轮缩放 */
  profile: ExposureProfileBar[];
  tickSize: number;
  spot?: number;
  gammaFlip?: number;
  keyGammaStrike?: number;
  callWall?: number;
  putWall?: number;
}

export function buildExposureProfileModel(viewModel: DashboardViewModel): ExposureProfileModel {
  const profile = (viewModel.allGammaRows.length ? viewModel.allGammaRows : viewModel.gammaRows)
    .map((row) => ({
      strike: row.strike,
      callOI: row.callOI,
      putOI: row.putOI,
      callGex: row.callGEX,
      putGex: row.putGEX,
      netDelta: row.netDelta,
      netCharm: row.netCharm,
    }))
    .sort((a, b) => a.strike - b.strike);

  return {
    profile,
    tickSize: viewModel.tickSize,
    spot: viewModel.spot,
    gammaFlip: viewModel.gammaFlip,
    keyGammaStrike: viewModel.keyGammaStrike,
    callWall: viewModel.callWall,
    putWall: viewModel.putWall,
  };
}
