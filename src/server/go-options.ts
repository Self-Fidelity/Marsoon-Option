import "server-only";
import { sanitizeDataCopy, sanitizePublicData } from "@/lib/data-messages";
import { allowedStatusEntry, bindOptionQuery, checkBoundResponse, fixedOptionUnderlying } from "./option-underlying";
import { attachAvailableCandles, sessionStart } from "./intraday-candles";
import { backendOptionScope, defaultDashboardDays } from "./option-scope-routing";
import type { OptionsChainResponse, OptionsDashboardResponse, OptionsIntradayResponse } from "@/api/options";
import type { OptionProduct, OptionScope } from "@/api/options";
import { composeChainFromDashboard } from "./chain-from-dashboard";

type Row = Record<string, unknown>;
function object(v: unknown): Row { if (!v || typeof v !== "object" || Array.isArray(v)) throw new GoOptionsError("Go期权响应结构无效"); return v as Row; }
function list(v: unknown): Row[] { if (!Array.isArray(v)) throw new GoOptionsError("Go期权响应数组无效"); return v.map(object); }
function number(v: unknown) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
const chicagoTradingDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
function cmeTradingDayAt(unix: number) {
  const parts = Object.fromEntries(chicagoTradingDay.formatToParts(unix * 1000).map((part) => [part.type, Number(part.value)]));
  let day = Date.UTC(parts.year!, parts.month! - 1, parts.day!);
  const weekday = new Date(day).getUTCDay();
  if (weekday === 6) day -= 86400000;
  else if (weekday === 0) day += parts.hour! >= 17 ? 86400000 : -2 * 86400000;
  else if (weekday !== 5 && parts.hour! >= 17) day += 86400000;
  return new Date(day).toISOString().slice(0, 10);
}
function shiftDay(day: string, offset: number) { return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }

export class GoOptionsError extends Error { constructor(message: string, readonly status = 502) { super(message); } }
/**
 * 上游超时按接口分级（2026-09-11 按 Go 实测重对齐）。
 *
 * 实测：Go 重聚合接口常态 25~60s——dashboard/chain 多次恰好 25.0s 被掐成 502、
 * underlying-bars 整窗恰好 35.0s 被掐、options_only 串行叠加顶爆 60s 路由预算变 504。
 * 而同一时段 Go 实际能答（close dashboard 200 in 24.0s、options_only 200 in 54~60s）。
 * 结论：宁可等它慢返回，不可把"慢但有数据"切成空态。上游一律放宽到 55s，
 * 配套路由预算 115s、前端默认 120s。
 * `/options/heatmap` 25s 为订单流足迹图页面专用保留项，不动。
 * `OPTIONS_UPSTREAM_TIMEOUT_MS` 可整体覆盖默认值。
 */
const UPSTREAM_TIMEOUT_MS: Record<string, number> = {
  "/options/status": 15_000,
  "/options/term": 30_000,
  "/options/dashboard": 55_000,
  "/options/chain": 55_000,
  "/options/heatmap": 25_000,
  "/options/levels": 55_000,
  "/options/intraday": 55_000,
  "/options/underlying-bars": 55_000,
  "/options/0dte-volume-profile": 55_000,
};
const DEFAULT_UPSTREAM_TIMEOUT_MS = Number(process.env.OPTIONS_UPSTREAM_TIMEOUT_MS) || 30_000;
function upstreamTimeoutMs(path: string) { return UPSTREAM_TIMEOUT_MS[path] ?? DEFAULT_UPSTREAM_TIMEOUT_MS; }
const VOLUME_PROFILE_MAX_WINDOW_SEC = 7200;
const globalCache = globalThis as typeof globalThis & { optionGoCache?: Map<string, { value: Promise<unknown>; settledAt?: number }> };
const cache = globalCache.optionGoCache ??= new Map();
export async function upstream(path: string, query: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<unknown> {
  const base = process.env.OPTIONS_API_BASE_URL;
  if (!base) throw new GoOptionsError("尚未配置 Go 期权服务地址 OPTIONS_API_BASE_URL", 503);
  const portfolio = query.portfolio === "true";
  query = bindOptionQuery(path, query);
  const fixed = fixedOptionUnderlying(query.product);
  const url = new URL(path, base); for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  const key = url.toString(); const hit = cache.get(key); if (hit && (hit.settledAt === undefined || hit.settledAt + 10000 > Date.now())) return hit.value;
  const value = (async () => {
    let response: Response;
    const timeout = AbortSignal.timeout(upstreamTimeoutMs(path));
    try { response = await fetch(url, { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { Accept: "application/json", ...(process.env.OPTIONS_API_TOKEN ? { Authorization: `Bearer ${process.env.OPTIONS_API_TOKEN}` } : {}) } }); }
    catch { throw new GoOptionsError("Go 期权服务无法连接或请求超时"); }
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new GoOptionsError("Go 地址返回了网页，未返回期权 JSON 数据，请检查服务地址与路由");
    if (!response.ok) throw new GoOptionsError(response.status === 404 ? `Go 服务尚未提供 ${path} 接口` : `Go 期权接口错误（HTTP ${response.status}）`, response.status);
    const data = await response.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (typeof data.missing_reason === "string") data.missing_reason = sanitizeDataCopy(data.missing_reason) ?? "当前暂无可用数据";
      if (typeof data.data_notice === "string") data.data_notice = sanitizeDataCopy(data.data_notice);
      if (typeof data.error === "string") data.error = sanitizeDataCopy(data.error) ?? "数据请求失败";
    }
    if (fixed && !portfolio) {
      checkBoundResponse(data, fixed);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        data.underlying_symbol ??= fixed;
        if (data.has_data === false) data.missing_reason = sanitizeDataCopy(data.missing_reason ? `${fixed}：${data.missing_reason}` : `${fixed} 当前周期暂无期权数据`) ?? "当前周期暂无期权数据";
      }
    }
    return data;
  })();
  const entry: { value: Promise<unknown>; settledAt?: number } = { value };
  value.then(() => { entry.settledAt = Date.now(); }, () => { entry.settledAt = Date.now(); });
  cache.set(key, entry);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  try { return await value; } catch (e) { if (cache.get(key)?.value === value) cache.delete(key); throw e; }
}
export function params(request: Request) {
  const q = new URL(request.url).searchParams; const p = (q.get("product") ?? "NQ").toUpperCase(); const s = q.get("scope") ?? "0dte";
  if (!["NQ", "ES", "GC"].includes(p) || !["0dte", "d30", "d90", "close"].includes(s)) throw new GoOptionsError("品种或周期参数无效", 400);
  return { product: p as OptionProduct, scope: s as OptionScope, query: q };
}
export async function route(work: (signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal) {
  let budget: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<never>((_, reject) => {
      // 路由总预算 115s：须大于最慢上游超时（55s）+ 前置 status/合约解析余量；
      // 2026-09-11 实测 60s 预算会被 options_only 的串行链路顶爆（504）。
      budget = setTimeout(() => reject(new GoOptionsError("期权数据请求超时", 504)), 115_000);
      budget.unref?.();
    });
    return Response.json(sanitizePublicData(await Promise.race([work(signal), limit])), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(sanitizePublicData({ error: sanitizeDataCopy(e instanceof Error ? e.message : undefined) ?? "期权数据请求失败" }), { status: e instanceof GoOptionsError ? e.status : 502, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(budget);
  }
}
/** 空态看板：形状完整、has_data=false——是否空态由 Go 裁决，BFF 只在 Go 返回空时补全契约形状。 */
function emptyDashboard(product: OptionProduct, scope: OptionScope, reason: string): OptionsDashboardResponse {
  return { product, scope, source: "options-http", has_data: false, missing_reason: reason, snapshot_unix: 0, market_state: null, summary: null, levels: [], expiries: [], heatmap: { observed_min_unix: 0, observed_max_unix: 0, cells: [], levels: [] } };
}
/**
 * resolvedUnderlying 会话级缓存（《周期管理与防堵塞设计》§七-3）：
 * 原实现每次调用都先打 /options/status（10s 超时），Go 抖动时 status 先死，
 * 包括 bars_only 在内的所有路由陪葬（实测大量恰好 10.0s 的 502）。
 * 合约映射在换月前不变：成功结果缓存 5 分钟，失败不缓存。
 */
const resolvedUnderlyingCache = new Map<string, { symbol: string; at: number }>();
const RESOLVED_UNDERLYING_TTL_MS = 5 * 60_000;

export async function resolvedUnderlying(product: OptionProduct, signal?: AbortSignal) {
  const fixed = fixedOptionUnderlying(product);
  if (fixed) return fixed;
  const hit = resolvedUnderlyingCache.get(product);
  if (hit && hit.at + RESOLVED_UNDERLYING_TTL_MS > Date.now()) return hit.symbol;
  const symbol = await resolveUnderlyingUncached(product, signal);
  if (symbol) resolvedUnderlyingCache.set(product, { symbol, at: Date.now() });
  return symbol;
}

async function resolveUnderlyingUncached(product: OptionProduct, signal?: AbortSignal) {
  const status = object(await upstream("/options/status", {}, signal));
  const rows = list(status.entries).filter((v) => v.product === product);
  for (const scope of ["0dte", "nearest", "all"] as const) {
    const states = rows.filter((v) => v.scope === scope).sort((a, b) => (number(b.unix) ?? 0) - (number(a.unix) ?? 0));
    if (typeof states[0]?.underlying_symbol === "string") return states[0].underlying_symbol;
  }
  return undefined;
}
async function latestStatusUnix(product: OptionProduct, scope: OptionScope, allowNearestFallback = true, signal?: AbortSignal) {
  try {
    const status = object(await upstream("/options/status", {}, signal));
    const backend = backendOptionScope(scope);
    const entries = list(status.entries).filter((entry) => entry.product === product);
    const candidates = backend === "0dte" && allowNearestFallback ? ["0dte", "nearest"] : [backend];
    for (const candidate of candidates) {
      const rows = entries
        .filter((entry) => entry.scope === candidate)
        .sort((a, b) => (number(b.unix) ?? 0) - (number(a.unix) ?? 0));
      const unix = number(rows[0]?.unix);
      if (unix && unix > 0) return unix;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
export async function dashboard(product: OptionProduct, scope: OptionScope, requestedDays?: number, asof?: number, signal?: AbortSignal) {
  // 全部 scope（含 close）与历史快照一律直连 Go——契约约定由 Go 自己裁决
  // （有数据给数据、没有回空态 missing_reason），BFF 不替后端判断、不做本地组合回退。
  const days = requestedDays ?? defaultDashboardDays(scope);
  const underlying = await resolvedUnderlying(product, signal);
  let emptyReason: string | undefined;
  const readDashboard = async (asofUnix?: number) => {
    const raw = object(await upstream("/options/dashboard", {
      product,
      scope: backendOptionScope(scope),
      days,
      window_pct: .12,
      current: "true",
      underlying,
      asof: asofUnix,
    }, signal));
    const cells = list((object(raw.heatmap ?? {})).cells ?? []);
    if (raw.has_data !== false && (cells.length > 0 || raw.summary || raw.market_state)) {
      return { ...raw, product, scope, underlying_symbol: raw.underlying_symbol ?? underlying };
    }
    if (typeof raw.missing_reason === "string") emptyReason = raw.missing_reason;
    return undefined;
  };
  const hit = await readDashboard(asof);
  if (hit) return hit;
  if (asof === undefined) {
    // A dashboard/heatmap must fall back to the same scope. A newer
    // `nearest` state is not a valid replacement for an older 0DTE surface.
    const snap = await latestStatusUnix(product, scope, false, signal);
    if (snap) {
      const retry = await readDashboard(snap);
      if (retry) return retry;
    }
  }
  return emptyDashboard(product, scope, emptyReason ?? "当前暂无看板数据");
}
export async function levels(request: Request, signal?: AbortSignal) {
  const { product, scope, query } = params(request); const tf = Number(query.get("timeframe") ?? 300); const now = Math.floor(Date.now() / 1000);
  let to = Number(query.get("to") ?? now + 1), from = Number(query.get("from") ?? now - 3600);
  // close 档是日结快照：客户端 now-1h 窗口与 EOD 快照时间错位恒空打（2026-09-11 实测），
  // 缺省窗口时锚定 status 里 close 快照的 unix 取窗；客户端显式传窗则尊重原值。
  if (scope === "close" && !query.get("to")) {
    const snap = await latestStatusUnix(product, "close", false, signal);
    if (snap) { from = snap - 3600; to = snap + tf; }
  }
  if (![from, to, tf].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 93 * 86400 || tf < 60 || tf % 60) throw new GoOptionsError("历史时间范围或周期无效", 400);
  // 全部 scope（含 close）直连 Go 裁决，BFF 不做本地过滤/短路。
  return upstream("/options/levels", { product, scope, from, to, timeframe: tf, underlying: query.get("underlying") ?? await resolvedUnderlying(product, signal), strict_underlying: "true" }, signal);
}
function currentFromDashboard(dash: Row): OptionsIntradayResponse["current"] {
  const state = object(dash.market_state ?? {});
  const summary = object(dash.summary ?? {});
  const levels = list(dash.levels ?? []);
  const pick = (...metrics: string[]) => {
    for (const metric of metrics) {
      const row = levels.find((item) => item.metric === metric && (number(item.rank) ?? 1) === 1);
      const price = number(row?.level);
      if (price != null && price > 0) return price;
    }
    return null;
  };
  return {
    captured_at: number(dash.snapshot_unix) ?? number(state.unix) ?? 0,
    spot: number(state.underlying_price) ?? number(summary.underlying_price),
    call_wall: pick("call_wall", "call_oi_wall", "call_gex_wall", "positive_gex_wall"),
    put_wall: pick("put_wall", "put_oi_wall", "put_gex_wall", "negative_gex_wall"),
    gamma_flip: pick("gamma_flip", "zero_gamma"),
    atm_iv: number(summary.atm_iv),
    expected_move: null,
  };
}

export async function intraday(request: Request, signal?: AbortSignal) {
  const { product, scope, query } = params(request);
  const optionsOnly = query.get("options_only") === "true";
  const now = Math.floor(Date.now() / 1000);
  const requestedTo = Number(query.get("to") ?? Math.floor(now / 60) * 60 + 1);
  const requestedFrom = Number(query.get("from") ?? requestedTo - 86400);
  const requestedAsof = Number(query.get("asof") ?? requestedTo - 1);
  if (![requestedFrom, requestedTo, requestedAsof].every(Number.isSafeInteger) || requestedFrom <= 0 || requestedTo <= requestedFrom || requestedTo - requestedFrom > 7 * 86400) throw new GoOptionsError("日内历史时间范围无效", 400);
  if (query.get("bars_only") === "true") {
    const underlying = await resolvedUnderlying(product, signal);
    const day = new Date(requestedAsof * 1000).toISOString().slice(0, 10);
    const empty = { product, scope, source: "options-http", day, has_data: false, bars: [], levels: [], current: null, missing_reason: "当前暂无日内行情", underlying_symbol: underlying } as OptionsIntradayResponse;
    if (!underlying) return empty;
    return finishIntraday(await attachAvailableCandles(empty, product, (path, query) => upstream(path, query, signal), undefined, underlying, { from: requestedFrom, to: requestedTo }));
  }
  // 锚点改用便宜的 status（15s 超时 + 10s 去重缓存）+ 5min 合约缓存；
  // 原实现先串行等一整次 dashboard（25~55s）再发 intraday，常态顶爆路由预算（实测 options_only 504/60s）。
  const snap = await latestStatusUnix(product, scope, true, signal);
  const underlying = await resolvedUnderlying(product, signal);
  // current 兜底：仅当 Go intraday 没回 current 时才懒触发一次 dashboard（best-effort，软上限 20s），
  // 不为兜底给每个请求都加一次 dashboard 扇出；面板另有版本驱动的 dashboard 查询提供水位。
  const dashSoftCap = new Promise<undefined>((resolve) => { const t = setTimeout(() => resolve(undefined), 20_000); t.unref?.(); });
  const from = snap && requestedTo < snap - 3600 ? snap - 86400 : requestedFrom;
  const to = snap && requestedTo < snap - 3600 ? snap + 3600 : Math.max(requestedTo, snap ? snap + 3600 : requestedTo);
  const asof = snap && (requestedAsof < snap - 7 * 86400 || requestedAsof > snap + 86400) ? snap : requestedAsof;
  if (![from, to, asof].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 7 * 86400) throw new GoOptionsError("日内历史时间范围无效", 400);
  const day = new Date((snap ?? asof) * 1000).toISOString().slice(0, 10);
  const empty = { product, scope, source: "options-http", day, has_data: false, bars: [], levels: [], current: null, missing_reason: "当前暂无日内行情", underlying_symbol: underlying } as OptionsIntradayResponse;
  let data = await unavailableEndpoint("/options/intraday", { product, scope, from, to, asof, underlying }, empty, signal) as OptionsIntradayResponse;
  const candleRange = { from, to };
  if (!optionsOnly) try {
    data = await attachAvailableCandles(data, product, (path, query) => upstream(path, query, signal), snap, underlying ?? data.underlying_symbol, candleRange);
  } catch (error) {
    if (error instanceof GoOptionsError) throw error;
    data = { ...data, candle_notice: error instanceof Error ? error.message : "K线读取失败" };
  }
  if (!optionsOnly && !(data.bars?.length) && snap && underlying) {
    const fallback = { from: snap - 86400, to: snap + 3600 };
    data = await unavailableEndpoint("/options/intraday", { product, scope, from: fallback.from, to: fallback.to, asof: snap, underlying }, data, signal) as OptionsIntradayResponse;
    try {
      data = await attachAvailableCandles(data, product, (path, query) => upstream(path, query, signal), snap, underlying, fallback);
    } catch { /* keep whatever bars we already have */ }
  }
  if (!data.current) {
    const dash = (await Promise.race([
      dashboard(product, scope, undefined, undefined, signal).catch(() => undefined),
      dashSoftCap,
    ])) as Row | undefined;
    if (dash && dash.has_data !== false && number(dash.snapshot_unix)) data = { ...data, current: currentFromDashboard(dash) };
  }
  if (optionsOnly && data.bars?.length) data = { ...data, bars: [] };
  // levels[] 轨迹裁剪（2026-09-12）：全仓 grep 确认 intraday 的 levels 无任何消费方
  // （唯一 levels 消费方是 /options/levels 端点的旧仪表盘页）；GC 实测 1164 条约 150KB、
  // 占响应近九成，体积直接放大 55s 上游超时打爆的概率（水位线只依赖 current）。
  data = { ...data, levels: [] };
  if ((data.bars?.length ?? 0) > 0) data = { ...data, has_data: true, missing_reason: undefined };
  if (underlying && (data.underlying_symbol == null || data.candle_underlying_symbol == null)) {
    data = { ...data, underlying_symbol: data.underlying_symbol ?? underlying, candle_underlying_symbol: data.candle_underlying_symbol ?? underlying };
  }
  return finishIntraday(data);
}
function finishIntraday(data: OptionsIntradayResponse): OptionsIntradayResponse {
  if (typeof data.candle_notice === "string") return { ...data, candle_notice: sanitizeDataCopy(data.candle_notice) };
  return data;
}
export async function optionVolumeProfile(request: Request, signal?: AbortSignal) {
  const { product, query } = params(request);
  const requestedFrom = Number(query.get("from"));
  const to = Number(query.get("to"));
  if (![requestedFrom, to].every(Number.isSafeInteger) || requestedFrom <= 0 || to <= requestedFrom || to - requestedFrom > 7 * 86400) {
    throw new GoOptionsError("期权成交量时间范围无效", 400);
  }
  let windowClamped = false;
  const clampFrom = (rangeFrom: number, rangeTo: number) => {
    const clamped = Math.max(rangeFrom, rangeTo - VOLUME_PROFILE_MAX_WINDOW_SEC);
    if (clamped !== rangeFrom) windowClamped = true;
    return clamped;
  };
  const from = clampFrom(requestedFrom, to);
  // 轻量锚点：status（10s 去重缓存内基本免费）+ 5min 合约缓存；原实现每次 VP 都先串一整次 dashboard。
  const liveSnap = await latestStatusUnix(product, "0dte", true, signal);
  const liveUnderlying = await resolvedUnderlying(product, signal);
  const read = async (rangeFrom: number, rangeTo: number) => {
    const raw = object(await unavailableEndpoint("/options/0dte-volume-profile", { product, from: rangeFrom, to: rangeTo, underlying: liveUnderlying }, { rows: [] }, signal));
    return list(raw.rows ?? []);
  };
  let upstreamOk = false;
  let upstreamError: unknown;
  const tryRead = async (rangeFrom: number, rangeTo: number) => {
    try {
      const result = await read(rangeFrom, rangeTo);
      upstreamOk = true;
      return result;
    } catch (error) {
      upstreamError = error;
      return [] as Row[];
    }
  };
  let rows: Row[] = [];
  let sourceFrom = from;
  let sourceTo = to;
  let fallbackDays = 0;
  let fallback = false;
  rows = await tryRead(from, to);
  if (!rows.length && liveSnap) {
    fallback = true;
    sourceTo = liveSnap + 3600;
    sourceFrom = clampFrom(liveSnap - 86400, sourceTo);
    rows = await tryRead(sourceFrom, sourceTo);
  }
  if (!rows.length) {
    fallback = true;
    const baseDay = cmeTradingDayAt((liveSnap ?? to) - 1);
    for (let offset = 0; offset <= 7; offset++) {
      const day = shiftDay(baseDay, -offset);
      const nextDay = shiftDay(day, 1);
      sourceTo = sessionStart(nextDay);
      sourceFrom = clampFrom(sessionStart(day), sourceTo);
      rows = await tryRead(sourceFrom, sourceTo);
      if (rows.length) { fallbackDays = offset; break; }
    }
  }
  if (!rows.length && !upstreamOk) throw upstreamError;
  const byStrike = new Map<number, { strike: number; call_volume: number; put_volume: number }>();
  for (const row of rows) {
    const strike = number(row.strike);
    if (strike === null) continue;
    const contracts = (prefix: "call" | "put") =>
      (number(row[`${prefix}_buy_contracts`]) ?? 0) +
      (number(row[`${prefix}_sell_contracts`]) ?? 0) +
      (number(row[`${prefix}_unknown_contracts`]) ?? 0);
    const callVolume = number(row.call_volume) ?? contracts("call");
    const putVolume = number(row.put_volume) ?? contracts("put");
    if (callVolume <= 0 && putVolume <= 0) continue;
    const current = byStrike.get(strike) ?? { strike, call_volume: 0, put_volume: 0 };
    current.call_volume += callVolume;
    current.put_volume += putVolume;
    byStrike.set(strike, current);
  }
  return {
    product,
    scope: "0dte",
    from,
    to,
    source_from: sourceFrom,
    source_to: sourceTo,
    fallback,
    fallback_days: fallbackDays,
    window_clamped: windowClamped,
    underlying_symbol: liveUnderlying,
    has_data: byStrike.size > 0,
    missing_reason: byStrike.size > 0 ? undefined : "当前暂无期权成交量数据",
    rows: [...byStrike.values()].sort((a, b) => b.strike - a.strike),
  };
}

export async function chain(request: Request, signal?: AbortSignal) {
  const { product, scope, query } = params(request);
  const expirationRaw = Number(query.get("expiration"));
  const expiration = Number.isSafeInteger(expirationRaw) && expirationRaw > 0 ? expirationRaw : undefined;
  const underlying = await resolvedUnderlying(product, signal);
  const empty: OptionsChainResponse = {
    product,
    scope,
    source: "options-http",
    has_data: false,
    snapshot_unix: 0,
    selected_expiration: 0,
    series: [],
    chain: null,
    missing_reason: "当前暂无期权链数据",
    underlying_symbol: underlying,
  };
  const live = object(await unavailableEndpoint("/options/chain", {
    product,
    scope,
    series_id: query.get("series_id") ?? undefined,
    expiration,
    underlying,
  }, empty, signal)) as OptionsChainResponse & Row;
  const liveRows = live.chain && typeof live.chain === "object" ? list((live.chain as unknown as Row).rows ?? []) : [];
  if (live.has_data !== false && liveRows.length > 0) return { ...live, product, scope };
  return composeChainFromDashboard(await dashboard(product, scope, undefined, undefined, signal) as OptionsDashboardResponse, product, scope, expiration);
}
export async function term(request: Request, signal?: AbortSignal) {
  const { product, scope } = params(request);
  const empty = {
    product,
    scope,
    source: "options-http",
    has_data: false,
    expiry_points: [],
    serie_points: [],
    iv_spread: null,
    bcr: null,
    missing_reason: "当前暂无期限结构数据",
  };
  const data = object(await unavailableEndpoint("/options/term", { product, scope: backendOptionScope(scope) }, empty, signal));
  const expiryPoints = list(data.expiry_points ?? []);
  const hasIv = expiryPoints.some((point) => number(point.iv_official) != null || number(point.pcr_oi) != null || number(point.pcr_vol) != null);
  if (hasIv) return { ...data, product, scope };

  const mapExpiries = (dash: Row) => {
    const snap = number(dash.snapshot_unix) ?? Math.floor(Date.now() / 1000);
    return list(dash.expiries ?? []).map((expiry) => {
      const expiration = number(expiry.expiration) ?? 0;
      return {
        dte: expiration > 0 ? Math.max(0, Math.round((expiration - snap) / 86400)) : number(expiry.dte) ?? 0,
        expiration,
        iv_official: number(expiry.atm_iv),
        pcr_oi: number(expiry.put_call_oi_ratio),
        pcr_vol: null,
      };
    }).filter((point) => point.expiration > 0).sort((a, b) => a.dte - b.dte);
  };

  // 0dte 只有单个到期，期限结构几乎必然要从 d90 到期表面取数。
  // 旧实现串行"先 0dte、不够再 d90"，最坏 term(30s)+dashboard(55s)+dashboard(55s)=140s
  // 顶爆 115s 路由预算恒 504（2026-09-11 实测）；改并发后最坏 30+55=85s。
  // upstream() 的 10s 在途去重会吸收与面板自身 dashboard 查询的重复算力。
  const [primaryDash, widerDash] = scope === "0dte"
    ? await Promise.all([
        dashboard(product, scope, undefined, undefined, signal),
        dashboard(product, "d90", undefined, undefined, signal),
      ])
    : [await dashboard(product, scope, undefined, undefined, signal), null];
  let dash = object(primaryDash);
  let fromDash = mapExpiries(dash);
  let notice = "IV / PCR 来自看板到期汇总";
  if (widerDash && fromDash.length < 2) {
    const widerPoints = mapExpiries(object(widerDash));
    if (widerPoints.length > fromDash.length) {
      dash = object(widerDash);
      fromDash = widerPoints;
      notice = "0DTE 只有一个到期，期限结构改用 90 天到期表面";
    }
  }
  if (!fromDash.length) {
    return {
      ...empty,
      missing_reason: typeof data.missing_reason === "string" ? data.missing_reason : empty.missing_reason,
    };
  }
  const withIv = fromDash.filter((point) => point.iv_official != null);
  const ivSpread = withIv.length >= 2 && withIv[0]!.iv_official != null && withIv[1]!.iv_official != null
    ? {
        front: withIv[0]!.iv_official,
        back: withIv[1]!.iv_official,
        spread: withIv[0]!.iv_official - withIv[1]!.iv_official,
        inverted: withIv[0]!.iv_official > withIv[1]!.iv_official,
      }
    : null;
  return {
    ...data,
    product,
    scope,
    has_data: true,
    missing_reason: undefined,
    data_notice: notice,
    snapshot_unix: number(dash.snapshot_unix),
    expiry_points: fromDash,
    serie_points: fromDash.map((point) => ({ dte: point.dte, atm_iv: point.iv_official, label: `${point.dte}D` })),
    iv_spread: ivSpread,
  };
}
export async function unavailableEndpoint(path: string, query: Record<string, string | number | undefined>, empty: unknown, signal?: AbortSignal) {
  try { return await upstream(path, query, signal); }
  catch (error) { if (error instanceof GoOptionsError && error.status === 404) return empty; throw error; }
}
export async function sourceStatus(signal?: AbortSignal) {
  const status = object(await upstream("/options/status", {}, signal));
  return { ...status, entries: list(status.entries).filter(allowedStatusEntry) };
}

/**
 * 极轻数据版本：只输出 (product, scope, unix) 三元组，供前端做脏更新
 * —— 版本号不变则不重复拉取大响应。同一 (product, scope) 只保留最新快照，
 * 避免上游多版本条目（或陈旧残留）被误判为更新。
 */
export async function dataVersion(signal?: AbortSignal) {
  const status = object(await upstream("/options/status", {}, signal));
  const latest = new Map<string, { product: string; scope: string; unix: number }>();
  for (const entry of list(status.entries).filter(allowedStatusEntry)) {
    const product = typeof entry.product === "string" ? entry.product : undefined;
    const scope = typeof entry.scope === "string" ? entry.scope : undefined;
    const unix = number(entry.unix);
    if (!product || !scope || !unix) continue;
    const key = `${product}/${scope}`;
    const previous = latest.get(key);
    if (!previous || unix > previous.unix) latest.set(key, { product, scope, unix });
  }
  const entries = [...latest.values()].sort((a, b) => (a.product + "/" + a.scope).localeCompare(b.product + "/" + b.scope));
  return { v: entries.map((entry) => `${entry.product}:${entry.scope}:${entry.unix}`).join("|"), entries };
}
