/**
 * 产品分析共享层：同一份快照的 Black-76 计算只做一次，dashboard / levels / chain
 * 三个路由全部从这里取结果（按快照 capturedAt 记忆化，快照不更新不重复计算）。
 *
 * 同时集中两件事：
 *  - scope → serie 的选择语义（0dte / d30 / d90 / all；close 不落引擎，路由层直接回空态），
 *    三个路由不再各自实现
 *  - 0DTE 判定：barchart 的 DTE 在到期当天仍为 1，按"到期日=芝加哥今日"映射为 0
 */

import {
  optionProductConfig,
  type ComputedScope,
  type OptionProduct,
} from "@/api/options";

import {
  analyzeChain,
  combineAnalytics,
  type ChainAnalytics,
} from "./barchart-greeks";
import {
  readBarchartCapturedAt,
  readBarchartProduct,
  type BarchartSerieSnapshot,
} from "./barchart-store";

export interface SerieAnalysis {
  serie: BarchartSerieSnapshot;
  /** 该 serie 的标的期货价（serie 可挂非主合约：GC 周期权→GCV26） */
  F: number;
  analytics: ChainAnalytics;
}

export interface ScopeSelection {
  analytics: ChainAnalytics;
  /** 0 = 不按到期过滤（scope=all） */
  expiration: number;
  /** 所选口径的标的价格（all = 主合约现价） */
  F: number;
}

export interface ProductAnalysis {
  product: OptionProduct;
  capturedAt: number;
  spot: number;
  multiplier: number;
  /** 全部有效 serie，按 DTE 升序 */
  perSerie: SerieAnalysis[];
  selected: Record<ComputedScope, ScopeSelection>;
}

/**
 * 当日到期判定：到期日 = 芝加哥"当日"（CME 口径；barchart DTE 在到期当天显示 1，不能直接用）。
 * referenceDate 可注入：回放历史快照时必须用该轮 capturedAt，而非服务器今天（06 日内面板）。
 */
function isExpiringToday(expirationDate: string, referenceDate: Date = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(expirationDate);
  if (!m) return false;
  const ct = referenceDate
    .toLocaleDateString("en-US", { timeZone: "America/Chicago" })
    .split("/")
    .map(Number); // en-US → M/D/YYYY
  return Number(m[1]) === ct[0] && Number(m[2]) === ct[1] && 2000 + Number(m[3]) === ct[2];
}

const cache = new Map<OptionProduct, { capturedAt: number; analysis: ProductAnalysis | null }>();
/** 同 key 后台补算 in-flight 去重（R1/R2：请求路径绝不同步全链重算） */
const inflight = new Set<OptionProduct>();
/** 每 key 上次计算耗时（R4：>2s 打警告日志，大行情先看日志趋势） */
const lastComputeMs = new Map<OptionProduct, number>();

function computeAndCache(product: OptionProduct, capturedAt: number): ProductAnalysis | null {
  const t0 = performance.now();
  const analysis = buildAnalysis(product, capturedAt);
  const ms = performance.now() - t0;
  lastComputeMs.set(product, ms);
  if (ms > 2000) {
    console.warn(`[analysis] 全链计算耗时 ${ms.toFixed(0)}ms（>2s 阈值）`);
  }
  cache.set(product, { capturedAt, analysis });
  return analysis;
}

/** 后台补算：不阻塞调用方，同 key 只跑一份 */
function scheduleCompute(product: OptionProduct, capturedAt: number) {
  if (inflight.has(product)) return;
  inflight.add(product);
  // setImmediate 摘出当前请求/调用栈；计算本身是同步 CPU 活，Node 单进程下串行执行
  setImmediate(() => {
    try {
      computeAndCache(product, capturedAt);
    } catch (err) {
      console.error(`[analysis] 后台补算失败:`, err);
    } finally {
      inflight.delete(product);
    }
  });
}

/**
 * R1 ingest 扇出：快照入库后由数据侧主动调一次，把 3 品种的全链分析
 * （每品种一次计算覆盖 0dte/d30/d90/all 四档）推进记忆化缓存。
 * 入口无关设计：REST 路由与未来的 WS 消费者都调它（见看板架构演进 R1 警告）。
 * 异步串行执行，调用方（ingest POST）立即返回。
 */
export function fanoutAnalysis(capturedAt: number) {
  for (const product of ["ES", "NQ", "GC"] as const) {
    const hit = cache.get(product);
    if (hit && hit.capturedAt === capturedAt) continue;
    scheduleCompute(product, capturedAt);
  }
}

/**
 * 对一份产品快照做全量分析（per-serie + 四种 scope 选择）。
 * referenceDate 决定 0DTE 判定的"当日"：实时路由传服务器当前时间，
 * 06 日内回放传该轮快照 capturedAt。
 */
export function analyzeProductSnapshot(
  product: OptionProduct,
  snap: NonNullable<ReturnType<typeof readBarchartProduct>>,
  capturedAt: number,
  referenceDate: Date = new Date(),
): ProductAnalysis | null {
  const spot = snap.quote.lastPrice;
  if (!(spot > 0)) return null;
  const multiplier = optionProductConfig[product].multiplier;

  const perSerie = snap.series
    .map((serie) => {
      const F = (serie.futures ? snap.quotes?.[serie.futures]?.lastPrice : null) || spot;
      // 到期当天按 0DTE 口径进引擎（T 地板 0.35 天在 analyzeChain 内处理）
      const dte = isExpiringToday(serie.expirationDate, referenceDate) ? 0 : serie.daysToExpiration;
      return { serie, F, analytics: analyzeChain(serie.chain, F, dte, multiplier) };
    })
    .filter(
      (x): x is { serie: typeof x.serie; F: number; analytics: NonNullable<typeof x.analytics> } =>
        x.analytics !== null,
    )
    .sort((a, b) => a.analytics.daysToExpiration - b.analytics.daysToExpiration);
  if (perSerie.length === 0) return null;

  const zeroDte = perSerie.find((x) => x.analytics.daysToExpiration === 0) ?? perSerie[0]!;
  const combine = (subset: SerieAnalysis[]) =>
    combineAnalytics(
      subset.map((x) => ({
        analytics: x.analytics,
        expirationUnix: x.serie.expirationUnix,
        F: x.F,
      })),
      spot,
      multiplier,
    );
  // d30/d90：DTE ≤ 30 / ≤ 90 的全部 serie 聚合（含 0DTE，嵌套口径 0DTE ⊂ 30DTE ⊂ 90D ⊂ 全部），
  // 聚合路径与 all 相同，只是 serie 子集不同
  const d30Serie = perSerie.filter((x) => x.analytics.daysToExpiration <= 30);
  const d30Combined = combine(d30Serie.length > 0 ? d30Serie : [perSerie[0]!]);
  const d90Serie = perSerie.filter((x) => x.analytics.daysToExpiration <= 90);
  const d90Combined = combine(d90Serie.length > 0 ? d90Serie : [perSerie[0]!]);
  const combined = combine(perSerie);
  if (!d30Combined || !d90Combined || !combined) return null;

  return {
    product,
    capturedAt,
    spot,
    multiplier,
    perSerie,
    selected: {
      "0dte": { analytics: zeroDte.analytics, expiration: zeroDte.serie.expirationUnix, F: zeroDte.F },
      d30: { analytics: d30Combined, expiration: 0, F: spot },
      d90: { analytics: d90Combined, expiration: 0, F: spot },
    },
  };
}

/** 实时路径：从内存仓取快照，0DTE 判定用服务器当前日期 */
function buildAnalysis(product: OptionProduct, capturedAt: number): ProductAnalysis | null {
  const snap = readBarchartProduct(product);
  if (!snap) return null;
  return analyzeProductSnapshot(product, snap, capturedAt);
}

/**
 * 取产品分析结果：同一快照只算一次。
 * 返回 null 表示无可用快照（调用方回退 local-demo 或 404）。
 * 同步计算版：仅供 ingest 扇出/后台补算与非请求路径使用；
 * 请求路径必须用 getProductAnalysisCached（R1：禁止请求内同步全链重算）。
 */
export function getProductAnalysis(product: OptionProduct): ProductAnalysis | null {
  const capturedAt = readBarchartCapturedAt();
  if (capturedAt === null) return null;
  const hit = cache.get(product);
  if (hit && hit.capturedAt === capturedAt) return hit.analysis;
  return computeAndCache(product, capturedAt);
}

/**
 * 请求路径专用（R1）：只读缓存。miss 时返回 null 并触发后台补算，
 * 绝不在请求里同步跑全链 Black-76（宁可短暂空态，不可阻塞事件循环）。
 */
export function getProductAnalysisCached(product: OptionProduct): ProductAnalysis | null {
  const capturedAt = readBarchartCapturedAt();
  if (capturedAt === null) return null;
  const hit = cache.get(product);
  if (hit && hit.capturedAt === capturedAt) return hit.analysis;
  scheduleCompute(product, capturedAt);
  return null;
}

/** R4 观测：各品种上次全链计算耗时（ms） */
export function readAnalysisComputeMs(): Record<string, number> {
  return Object.fromEntries(lastComputeMs);
}
