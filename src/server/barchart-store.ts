/**
 * Barchart 快照内存仓 v2：采集器 POST 上来的快照存这里，API 路由优先消费。
 * next start 单进程内 globalThis 共享；进程重启即清空（采集器下一轮会重建）。
 *
 * v2：链数据从单条 chain 升级为 series[]（月度/EOM/周度 1-5 多 serie）。
 */

import { sanitizeUserFacingText } from "@/lib/formatters";
import { sanitizePublicMessage } from "@/lib/data-messages";

export interface BarchartChainRow {
  strike: number;
  optionType: "Call" | "Put";
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  oi: number | null;
  isSettlement: boolean;
}

export interface BarchartExpiryInfo {
  expirationDate: string; // MM/DD/YY 原始格式
  expirationUnix: number;
  expirationType: string; // weekly | monthly
  daysToExpiration: number;
  putCallVolumeRatio: number | null;
  putCallOiRatio: number | null;
  volatility: number | null; // 小数（口径脏，仅供展示参考）
}

export interface BarchartSerieSnapshot {
  code: string; // 如 MV1U26 / ESU26
  kind: "monthly" | "eom" | "weekly" | "unknown";
  weekday: number | null; // weekly 时 0-6
  label: string;
  futures: string; // 该 serie 的标的期货（可能与主合约不同：GC 周期权挂 GCV26）
  expirationUnix: number;
  expirationDate: string;
  daysToExpiration: number;
  chain: BarchartChainRow[];
}

export interface BarchartBar1m {
  unix: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BarchartProductSnapshot {
  symbol: string; // 期货合约，如 ESU26
  quote: { lastPrice: number; priceChange: number | null; tradeTime: number | null };
  /** 每个标的期货的报价（serie 可能挂在非主合约上，按 symbol 索引） */
  quotes?: Record<
    string,
    { lastPrice: number; priceChange: number | null; tradeTime: number | null }
  >;
  expiries: BarchartExpiryInfo[];
  series: BarchartSerieSnapshot[];
  bars1m: BarchartBar1m[];
}

export interface BarchartStoreSnapshot {
  source: "barchart-webbridge";
  capturedAt: number; // ms
  intervalSec: number;
  products: Partial<Record<"ES" | "NQ" | "GC", BarchartProductSnapshot>>;
}

interface Store {
  snapshot: BarchartStoreSnapshot | null;
  lastIngestAt: number | null;
  ingestCount: number;
  lastError: string | null;
}

const globalKey = "__marsoonBarchartStore";

function getStore(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = { snapshot: null, lastIngestAt: null, ingestCount: 0, lastError: null };
  }
  return g[globalKey]!;
}

export function writeBarchartSnapshot(snapshot: BarchartStoreSnapshot) {
  const store = getStore();
  store.snapshot = snapshot;
  store.lastIngestAt = Date.now();
  store.ingestCount += 1;
  store.lastError = null;
}

export function writeBarchartError(message: string) {
  getStore().lastError = sanitizeUserFacingText(message) || "采集失败";
}

export function readBarchartProduct(
  product: "ES" | "NQ" | "GC",
): BarchartProductSnapshot | null {
  const snap = getStore().snapshot;
  if (!snap) return null;
  const p = snap.products[product];
  if (!p || p.series.length === 0) return null;
  return p;
}

/** 当前快照的采集时间（ms），供分析层按快照记忆化 */
export function readBarchartCapturedAt(): number | null {
  return getStore().snapshot?.capturedAt ?? null;
}

export function readBarchartStatus() {
  const store = getStore();
  const snap = store.snapshot;
  return {
    ok: snap !== null,
    capturedAt: snap?.capturedAt ?? null,
    lastIngestAt: store.lastIngestAt,
    intervalSec: snap?.intervalSec ?? 300,
    ingestCount: store.ingestCount,
    lastError: store.lastError
      ? sanitizePublicMessage(sanitizeUserFacingText(store.lastError), "数据更新失败")
      : null,
    products: snap
      ? Object.entries(snap.products).map(([k, v]) => ({
          product: k,
          symbol: v?.symbol ?? null,
          series: v?.series.length ?? 0,
          strikes: v?.series.reduce((a, s) => a + s.chain.length, 0) ?? 0,
          bars1m: v?.bars1m.length ?? 0,
          lastPrice: v?.quote.lastPrice ?? null,
        }))
      : [],
  };
}
