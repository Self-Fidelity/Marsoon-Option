import type { ReactNode } from "react";

import {
  ChainWindow,
  ExpirationWindow,
  GexWindow,
  IntradayWindow,
  OverviewWindow,
  SmileWindow,
  SpreadWindow,
} from "./panel-wrappers";

/**
 * 面板注册表：每窗三要素自包含——render 只收 panelId，
 * 品种/周期/联动/钉住全部走窗口配置 store（board-window-store.ts），
 * 不再有全局 ctx 透传。
 */
export interface BoardPanelDef {
  key: string;
  title: string;
  subtitle: string;
  chipLabel: string;
  implemented: boolean;
  /** 12 列网格下的默认位置（初稿布局） */
  defaultLayout: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
  render: (panelId: string) => ReactNode;
}

export const BOARD_PANELS: BoardPanelDef[] = [
  {
    key: "overview",
    title: "01 总览 Overview",
    subtitle: "REGIME SNAPSHOT",
    chipLabel: "总览",
    implemented: true,
    defaultLayout: { x: 0, y: 0, w: 12, h: 13, minW: 6, minH: 6 },
    render: () => <OverviewWindow />,
  },
  {
    key: "expiration",
    title: "05 到期热力图 Expiration",
    subtitle: "PRICE × EXPIRY",
    chipLabel: "热力图",
    implemented: true,
    defaultLayout: { x: 0, y: 13, w: 6, h: 14, minW: 4, minH: 7 },
    render: (panelId) => <ExpirationWindow panelId={panelId} />,
  },
  {
    key: "intraday",
    title: "06 日内变化 Intraday",
    subtitle: "BARS + LEVELS",
    chipLabel: "日内",
    implemented: true,
    defaultLayout: { x: 6, y: 13, w: 6, h: 14, minW: 4, minH: 7 },
    render: (panelId) => <IntradayWindow panelId={panelId} />,
  },
  {
    key: "volatility",
    title: "07 波动率微笑偏斜 Smile & Skew",
    subtitle: "IV BY STRIKE",
    chipLabel: "波动率",
    implemented: true,
    defaultLayout: { x: 0, y: 27, w: 6, h: 11, minW: 4, minH: 7 },
    render: (panelId) => <SmileWindow panelId={panelId} />,
  },
  {
    key: "gex",
    title: "08 Call / Put GEX 拆分",
    subtitle: "PER-STRIKE DEALER GEX",
    chipLabel: "GEX 拆分",
    implemented: true,
    defaultLayout: { x: 6, y: 27, w: 6, h: 14, minW: 4, minH: 7 },
    render: (panelId) => <GexWindow panelId={panelId} />,
  },
  {
    key: "chain",
    title: "09 期权链下钻",
    subtitle: "CHAIN DRILL-DOWN",
    chipLabel: "期权链",
    implemented: true,
    // 镜像表 + 下钻明细需要横向空间，默认占整行
    defaultLayout: { x: 0, y: 41, w: 12, h: 13, minW: 6, minH: 8 },
    render: (panelId) => <ChainWindow panelId={panelId} />,
  },
  {
    key: "spread",
    title: "10 月间价差 · 成交量 PCR",
    subtitle: "TERM SPREAD & PCR",
    chipLabel: "月间价差",
    implemented: true,
    defaultLayout: { x: 0, y: 54, w: 6, h: 11, minW: 4, minH: 7 },
    render: (panelId) => <SpreadWindow panelId={panelId} />,
  },
];
