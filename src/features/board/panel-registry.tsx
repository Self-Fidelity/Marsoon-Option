import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * 面板懒加载（2026-09-12 首载节流）：五个窗口整体进异步 chunk，
 * 首载不随 /board 同步下载（lightweight-charts 104KB gz 为最大头）；
 * 出厂布局首窗挂载时按序加载，骨架屏无感。窗口组件签名统一 (panelId, visible)。
 */
const panelFallback = (
  <div className="h-full w-full animate-pulse rounded-[10px] border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)]" />
);

const ExpirationWindow = dynamic(
  () => import("./panel-wrappers").then((m) => m.ExpirationWindow),
  { ssr: false, loading: () => panelFallback },
);
const IntradayWindow = dynamic(
  () => import("./panel-wrappers").then((m) => m.IntradayWindow),
  { ssr: false, loading: () => panelFallback },
);
const SmileWindow = dynamic(
  () => import("./panel-wrappers").then((m) => m.SmileWindow),
  { ssr: false, loading: () => panelFallback },
);
const ChainWindow = dynamic(
  () => import("./panel-wrappers").then((m) => m.ChainWindow),
  { ssr: false, loading: () => panelFallback },
);
const SpreadWindow = dynamic(
  () => import("./panel-wrappers").then((m) => m.SpreadWindow),
  { ssr: false, loading: () => panelFallback },
);

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
  render: (panelId: string, visible?: boolean) => ReactNode;
}

export const BOARD_PANELS: BoardPanelDef[] = [
  {
    key: "expiration",
    title: "05 到期热力图 Expiration",
    subtitle: "PRICE × EXPIRY",
    chipLabel: "热力图",
    implemented: true,
    defaultLayout: { x: 0, y: 13, w: 6, h: 14, minW: 4, minH: 7 },
    render: (panelId, visible) => <ExpirationWindow panelId={panelId} visible={visible} />,
  },
  {
    key: "intraday",
    title: "06 日内变化 Intraday",
    subtitle: "BARS + LEVELS",
    chipLabel: "日内",
    implemented: true,
    defaultLayout: { x: 6, y: 13, w: 6, h: 14, minW: 4, minH: 7 },
    render: (panelId, visible) => <IntradayWindow panelId={panelId} visible={visible} />,
  },
  {
    key: "volatility",
    title: "07 波动率微笑偏斜 Smile & Skew",
    subtitle: "IV BY STRIKE",
    chipLabel: "波动率",
    implemented: true,
    defaultLayout: { x: 0, y: 27, w: 6, h: 11, minW: 4, minH: 7 },
    render: (panelId, visible) => <SmileWindow panelId={panelId} visible={visible} />,
  },
  {
    key: "chain",
    title: "09 期权链下钻",
    subtitle: "CHAIN DRILL-DOWN",
    chipLabel: "期权链",
    implemented: true,
    // 镜像表 + 下钻明细需要横向空间，默认占整行
    defaultLayout: { x: 0, y: 41, w: 12, h: 13, minW: 6, minH: 8 },
    render: (panelId, visible) => <ChainWindow panelId={panelId} visible={visible} />,
  },
  {
    key: "spread",
    title: "10 月间价差 · 成交量 PCR",
    subtitle: "TERM SPREAD & PCR",
    chipLabel: "月间价差",
    implemented: true,
    defaultLayout: { x: 0, y: 54, w: 6, h: 11, minW: 4, minH: 7 },
    render: (panelId, visible) => <SpreadWindow panelId={panelId} visible={visible} />,
  },
];
