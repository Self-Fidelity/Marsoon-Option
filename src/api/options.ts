import { sanitizePublicMessage } from "@/lib/data-messages";
import { heavyLane, timedLane } from "@/lib/request-lanes";

export interface OptionDataMeta { missing_reason?: string; data_notice?: string; underlying_symbol?: string; }
export type OptionProduct = "NQ" | "ES" | "GC";
/**
 * Main 四层期权口径：close=前一 CME 交易日官方 EOD，
 * 0dte=当日到期、d30=DTE≤30 聚合（含 0DTE）、d90=DTE≤90 聚合（含 0DTE）。
 * Go/Rust 兼容层可继续持有 all/nearest，但不得进入 Main 的 OptionScope。
 */
export const OPTION_SCOPES = ["close", "0dte", "d30", "d90"] as const;
export type OptionScope = (typeof OPTION_SCOPES)[number];
/** 共享分析层实算的三档（close 由官方 EOD 独立计算） */
export type ComputedScope = Exclude<OptionScope, "close">;
export type QueryValue = string | number | boolean | undefined;

export const optionProductConfig = {
  NQ: { label: "纳指期货", multiplier: 20, tickSize: 0.25 },
  ES: { label: "标普期货", multiplier: 50, tickSize: 0.25 },
  GC: { label: "黄金期货", multiplier: 100, tickSize: 0.1 },
} as const satisfies Record<
  OptionProduct,
  { label: string; multiplier: number; tickSize: number }
>;

export interface MarketState {
  unix: number;
  expiration: number;
  underlying_symbol?: string;
  underlying_price?: number | null;
  regime?: string | null;
  net_gex?: number | null;
  gross_gex?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_flip?: number | null;
  quality_flags?: number;
}

export interface DashboardSummary {
  underlying_price?: number | null;
  regime?: string | null;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_flip?: number | null;
  key_gamma_strike?: number | null;
  net_gex?: number | null;
  gross_gex?: number | null;
  expected_move_upper?: number | null;
  expected_move_lower?: number | null;
  visible_put_call_oi_ratio?: number | null;
  zero_dte_gross_gex_share?: number | null;
  atm_iv?: number | null;
  quality_flags?: number;
}

export interface StrikeHeatmapCell {
  unix: number;
  expiration: number;
  underlying_symbol: string;
  strike: number;
  call_gex: number;
  put_gex: number;
  net_gex?: number;
  gross_gex?: number;
  net_delta_notional?: number | null;
  gross_delta_notional?: number | null;
  net_charm_notional?: number | null;
  gross_charm_notional?: number | null;
  call_oi?: number | null;
  put_oi?: number | null;
  call_vol?: number | null;
  put_vol?: number | null;
  call_iv?: number | null;
  put_iv?: number | null;
  quality_flags: number;
}

export interface SurfaceLevel {
  level?: number;
  underlying_symbol?: string;
  unix: number;
  expiration?: number;
  metric?: string;
  value?: number;
  strike?: number;
  rank?: number;
  quality_flags?: number;
}

export interface OptionLevelPoint {
  level?: number;
  unix: number;
  metric: string;
  rank?: number;
  value?: number | null;
  strike?: number | null;
  quality_flags?: number;
}

export interface OptionsLevelsResponse extends OptionDataMeta {
  source?: string;
  product: OptionProduct;
  scope: OptionScope;
  /** false = 当前 scope 尚无完整数据；缺省视同 true（兼容旧调用） */
  has_data?: boolean;
  from: number;
  to: number;
  timeframe: number;
  states: MarketState[];
  levels: OptionLevelPoint[];
}

export interface OptionDashboardExpiry {
  expiration: number;
  observed_min_unix?: number;
  observed_max_unix?: number;
  underlying_symbol?: string;
  call_oi?: number;
  put_oi?: number;
  total_oi?: number;
  call_gex?: number;
  put_gex?: number;
  net_gex?: number;
  gross_gex: number;
  delta?: number;
  charm?: number;
  atm_iv?: number | null;
  expected_move_upper?: number | null;
  expected_move_lower?: number | null;
  quality_flags?: number;
}

export interface OptionsDashboardResponse extends OptionDataMeta {
  source?: string;
  product: OptionProduct;
  scope?: OptionScope;
  /** false = 当前 scope 尚无完整数据；缺省视同 true */
  has_data?: boolean;
  /** 产品级视图：后端仍按实际期货合约分别计算。 */
  portfolio?: boolean;
  snapshot_unix: number;
  market_state?: MarketState | null;
  market_states?: MarketState[];
  summary?: DashboardSummary | null;
  levels?: SurfaceLevel[];
  expiries: OptionDashboardExpiry[];
  heatmap: {
    observed_min_unix: number;
    observed_max_unix: number;
    cells: StrikeHeatmapCell[];
    levels?: SurfaceLevel[];
  };
}

// --- 09 期权链下钻 ---

export interface OptionsChainSide {
  bid: number | null;
  ask: number | null;
  last: number | null;
  mid: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  /** Black-76 theta，原始口径：每年（展示层 ÷365 得每日） */
  theta: number | null;
  /** Black-76 vega，原始口径：每 1.00 波动率（展示层 ÷100 得每 1 vol pt） */
  vega: number | null;
  gex: number | null;
  oi: number | null;
  volume: number | null;
  /** 前一交易日结算价；缺失为 null */
  prev_close: number | null;
  /** 涨跌额：相对前一交易日结算价；缺失为 null */
  change: number | null;
  /** 涨跌幅：相对前一交易日结算价的比值；展示层转为百分数 */
  change_pct: number | null;
  is_settlement: boolean;
  iv_fallback: boolean;
}

export interface OptionsChainRow {
  strike: number;
  call: OptionsChainSide | null;
  put: OptionsChainSide | null;
}

export interface OptionsChainSerieMeta {
  series_id?: string;
  expiration: number;
  code: string;
  kind: "monthly" | "eom" | "weekly" | "unknown";
  label: string;
  weekday: number | null;
  days_to_expiration: number;
  futures: string;
  underlying_price: number;
  strikes: number;
}

export interface OptionsChainDetail {
  code: string;
  label: string;
  kind: string;
  expiration: number;
  days_to_expiration: number;
  futures: string;
  underlying_price: number;
  multiplier: number;
  atm_iv: number | null;
  call_wall: number | null;
  put_wall: number | null;
  gamma_flip: number | null;
  key_gamma_strike: number | null;
  max_pain: number | null;
  expected_move_upper: number | null;
  expected_move_lower: number | null;
  rows: OptionsChainRow[];
}

export interface OptionsChainResponse extends OptionDataMeta {
  source?: string;
  product: OptionProduct;
  scope?: OptionScope;
  /** false = 当前 scope 尚无完整数据；缺省视同 true */
  has_data?: boolean;
  snapshot_unix: number;
  selected_expiration: number;
  series: OptionsChainSerieMeta[];
  /** 当前 scope 空态时为 null */
  chain: OptionsChainDetail | null;
}

// --- 06 日内变化 Intraday ---

export interface IntradayBar {
  unix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  final?: boolean;
}

/** 每轮采集一个点；该产品该轮缺失时整点跳过（前端断线处理），字段可为 null */
export interface IntradayLevelPoint {
  /** 该轮快照 capturedAt（unix 秒） */
  t: number;
  spot: number | null;
  call_wall: number | null;
  put_wall: number | null;
  gamma_flip: number | null;
  atm_iv: number | null;
  /** 单边上下的绝对点数（±expected_move） */
  expected_move: number | null;
}

export interface IntradayCurrent {
  /** 现值来源快照的 capturedAt（unix 秒） */
  captured_at: number;
  spot: number | null;
  call_wall: number | null;
  put_wall: number | null;
  gamma_flip: number | null;
  atm_iv: number | null;
  expected_move: number | null;
}

export interface IntradayCurrentPosition {
  kind: "CW" | "PW" | "FLIP";
  price: number;
}

export interface OptionsIntradayResponse extends OptionDataMeta {
  /** Actual futures contract supplying the candles; never relabel a reference as the option underlying. */
  candle_underlying_symbol?: string;
  candle_is_reference?: boolean;
  candle_notice?: string;
  source?: string;
  product: OptionProduct;
  scope: OptionScope;
  /** 落盘文件日期（UTC，与 jsonl 命名一致） */
  day: string;
  /** false = 当天无落盘文件，bars/levels 为空数组（不返回模拟数据） */
  has_data: boolean;
  /** 快照版本锚点（current.captured_at 的冗余顶层字段，R3 轮询对齐用；无现值为 null） */
  snapshot_unix?: number | null;
  bars: IntradayBar[];
  levels: IntradayLevelPoint[];
  current: IntradayCurrent | null;
  /** 产品级周期可能同时包含多个后端期货合约的当前水位。 */
  current_positions?: IntradayCurrentPosition[];
}

export interface OptionVolumeProfileRow {
  strike: number;
  call_volume: number;
  put_volume: number;
}

export interface OptionVolumeProfileResponse extends OptionDataMeta {
  product: OptionProduct;
  scope: "0dte";
  from: number;
  to: number;
  source_from: number;
  source_to: number;
  fallback: boolean;
  fallback_days: number;
  window_clamped?: boolean;
  has_data: boolean;
  rows: OptionVolumeProfileRow[];
}

// --- 10 月间价差 Term Spread & PCR ---

export interface IvTermPoint {
  expiration: number;
  underlying_symbol: string;
  atm_iv: number | null;
  observed_min_unix: number;
  observed_max_unix: number;
}
export interface IvTermResponse extends OptionDataMeta {
  product: OptionProduct;
  scope: OptionScope;
  requested_date?: string;
  snapshot_unix: number;
  has_data: boolean;
  points: IvTermPoint[];
}

export function getIvTerm(product: OptionProduct, scope: OptionScope, date?: string, signal?: AbortSignal) {
  return getOptionsApi<IvTermResponse>("/api/options/iv-term", { product, scope, date }, signal, { lane: "heavy", label: `iv-term:${product}:${scope}`, priority: scope === "0dte" ? 1 : 0 });
}

/** 每到期一点（官方口径，快照 expiries[]，~82 个） */
export interface TermExpiryPoint {
  dte: number;
  iv_official: number | null;
  pcr_vol: number | null;
  pcr_oi: number | null;
}

/** 每 serie 一点（分析层 perSerie 自算 ATM IV，~7 个） */
export interface TermSeriePoint {
  dte: number;
  atm_iv: number | null;
  label: string;
}

/** 近远月 IV 价差：front/back = 最近两条有效 atmIv 的 serie；倒挂 = spread > 0（近月高于远月） */
export interface TermIvSpread {
  front: number;
  back: number;
  spread: number;
  inverted: boolean;
}

export interface OptionsTermResponse extends OptionDataMeta {
  source?: string;
  product: OptionProduct;
  /** 请求 scope 回显（close 空态时缺省） */
  scope?: OptionScope;
  /** 快照版本锚点（capturedAt 秒级），R3 前端轮询对齐用；无快照为 null */
  snapshot_unix?: number | null;
  /** false = 无快照或该 scope 窗口内无到期点，数组为空（不造数） */
  has_data: boolean;
  expiry_points: TermExpiryPoint[];
  serie_points: TermSeriePoint[];
  iv_spread: TermIvSpread | null;
  /** BCR 主动买量 / 主动卖量；Unknown 单列，缺失或卖量为零时 ratio=null */
  bcr: { buy_contracts: number; sell_contracts: number; unknown_contracts: number; ratio: number | null } | null;
}

export class OptionsApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OptionsApiError";
    this.status = status;
  }
}

function buildUrl(path: string, query: Record<string, QueryValue>): URL {
  const url = new URL(path, window.location.origin);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url;
}

let sessionRefreshInFlight: Promise<boolean> | null = null;

function refreshSessionOnce(): Promise<boolean> {
  if (!sessionRefreshInFlight) {
    sessionRefreshInFlight = fetch("/api/auth/session", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        sessionRefreshInFlight = null;
      });
  }
  return sessionRefreshInFlight;
}

// 须大于 BFF 路由总预算（115s）：Go 重聚合接口实测常态 25~60s，60s 会把"慢但有数据"掐在最后一刻。
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export async function getOptionsApi<T>(
  path: string,
  query: Record<string, QueryValue>,
  signal?: AbortSignal,
  lane?: { lane: "heavy"; priority?: number; label?: string } | { lane: "timed"; label?: string },
): Promise<T> {
  const execute = () => getOptionsApiInner<T>(path, query, signal);
  if (lane?.lane === "heavy") return heavyLane(lane.label ?? path, execute, lane.priority);
  if (lane?.lane === "timed") return timedLane(lane.label ?? path, execute);
  return execute();
}

async function getOptionsApiInner<T>(
  path: string,
  query: Record<string, QueryValue>,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const init: RequestInit = {
    signal: requestSignal,
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  };
  const request = () =>
    fetch(buildUrl(path, query), init).catch((cause: unknown) => {
      if (timeout.aborted) {
        throw new OptionsApiError("请求超时，请稍后重试。");
      }
      throw cause;
    });

  let response = await request();

  let refreshed = false;
  if (response.status === 401) {
    refreshed = await refreshSessionOnce();
    if (refreshed) {
      response = await request();
    }
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!contentType.includes("application/json")) {
    throw new OptionsApiError("暂时无法加载数据，请稍后重试。", response.status);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OptionsApiError("暂时无法加载数据，请稍后重试。", response.status);
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? sanitizePublicMessage(body.error, "请求未完成，请稍后重试。")
        : "请求未完成，请稍后重试。";
    if (response.status === 401 && !refreshed && typeof window !== "undefined") {
      window.location.assign("/login");
    }
    throw new OptionsApiError(message, response.status);
  }

  return body as T;
}

export function getOptionDashboard(
  product: OptionProduct,
  scope: OptionScope,
  signal?: AbortSignal,
  days?: number,
  asof?: number,
): Promise<OptionsDashboardResponse> {
  return getOptionsApi<OptionsDashboardResponse>(
    "/api/options/dashboard",
    // days 缺省不传：由 BFF 按 scope 给口径（0dte=1/d30=30/d90=90/close=45）。
    // 旧实现恒传 20，0dte 白传 20 天、close 把 45 天口径顶掉（更慢还取不齐）。
    { product, scope, days, window_pct: 0.12, asof },
    signal,
    { lane: "heavy", label: `dashboard:${product}:${scope}:${days ?? "auto"}`, priority: scope === "0dte" ? 1 : 0 },
  );
}

export function getOptionLevels(
  product: OptionProduct,
  scope: OptionScope,
  signal?: AbortSignal,
): Promise<OptionsLevelsResponse> {
  const timeframe = 300;
  const query: Record<string, string | number | undefined> = { product, scope, timeframe };
  if (scope !== "close") {
    const nowUnix = Math.floor(Date.now() / 1000);
    const latestBucket = Math.floor(nowUnix / timeframe) * timeframe;
    query.to = latestBucket + timeframe;
    query.from = latestBucket - 60 * 60;
  }
  // close 档是日结快照：now-1h 窗口与 EOD 快照时间错位恒空打，
  // 不传窗口，由 BFF 锚定 status 里的 close 快照 unix 取窗。

  return getOptionsApi<OptionsLevelsResponse>(
    "/api/options/levels",
    query,
    signal,
    { lane: "heavy", label: `levels:${product}:${scope}`, priority: scope === "0dte" ? 1 : 0 },
  );
}

export function getOptionChain(
  product: OptionProduct,
  expiration?: number,
  signal?: AbortSignal,
  scope: OptionScope = "0dte",
  seriesId?: string,
): Promise<OptionsChainResponse> {
  return getOptionsApi<OptionsChainResponse>(
    "/api/options/chain",
    { product, expiration, scope, series_id: seriesId },
    signal,
    // 优先级：显式 expiration = 09 用户下钻（2，队首）；0dte 档（1）；其余（0）
    { lane: "heavy", label: `chain:${product}:${scope}`, priority: expiration !== undefined ? 2 : scope === "0dte" ? 1 : 0 },
  );
}

export function getOptionIntraday(
  product: OptionProduct,
  scope: OptionScope,
  signal?: AbortSignal,
  range?: { from: number; to: number; asof?: number },
): Promise<OptionsIntradayResponse> {
  return getOptionsApi<OptionsIntradayResponse>(
    "/api/options/intraday",
    { product, scope, options_only: true, ...range },
    signal,
    { lane: "heavy", label: `options-only:${product}:${scope}`, priority: scope === "0dte" ? 1 : 0 },
  );
}

export function getOptionIntradayBars(
  product: OptionProduct,
  signal?: AbortSignal,
  range?: { from: number; to: number; asof?: number },
): Promise<OptionsIntradayResponse> {
  return getOptionsApi<OptionsIntradayResponse>(
    "/api/options/intraday",
    { product, scope: "0dte", bars_only: true, ...range },
    signal,
    // K 线走快车道：不占重车道信号量，仅计时（>3s 时 console.debug）
    { lane: "timed", label: `bars:${product}` },
  );
}

export function getOptionVolumeProfile(
  product: OptionProduct,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<OptionVolumeProfileResponse> {
  return getOptionsApi<OptionVolumeProfileResponse>(
    "/api/options/volume-profile",
    { product, from, to },
    signal,
    { lane: "heavy", label: `volume-profile:${product}`, priority: 1 },
  );
}

export function getOptionTerm(
  product: OptionProduct,
  scope?: OptionScope,
  signal?: AbortSignal,
): Promise<OptionsTermResponse> {
  return getOptionsApi<OptionsTermResponse>(
    "/api/options/term",
    { product, scope },
    signal,
    { lane: "heavy", label: `term:${product}:${scope}`, priority: scope === "0dte" ? 1 : 0 },
  );
}
