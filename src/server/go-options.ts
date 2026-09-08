import "server-only";
import { sanitizeDataCopy, sanitizePublicData } from "@/lib/data-messages";
import { allowedStatusEntry, bindOptionQuery, checkBoundResponse, fixedOptionUnderlying } from "./option-underlying";
import { attachAvailableCandles, sessionStart } from "./intraday-candles";
import { isCurrentPreviousEod } from "./eod-freshness";
import type { OptionsChainResponse, OptionsDashboardResponse, OptionsIntradayResponse } from "@/api/options";
import type { OptionProduct, OptionScope } from "@/api/options";
import { composeChainFromDashboard } from "./chain-from-dashboard";
import { composeDashboard, emptyDashboard, latestState, unsupportedScope, type LevelPage, type SurfacePage } from "./options-live-model";

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
const globalCache = globalThis as typeof globalThis & { optionGoCache?: Map<string, { until: number; value: Promise<unknown> }> };
const cache = globalCache.optionGoCache ??= new Map();
export async function upstream(path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const base = process.env.OPTIONS_API_BASE_URL;
  if (!base) throw new GoOptionsError("尚未配置 Go 期权服务地址 OPTIONS_API_BASE_URL", 503);
  const portfolio = query.portfolio === "true";
  query = bindOptionQuery(path, query);
  const fixed = fixedOptionUnderlying(query.product);
  const url = new URL(path, base); for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  const key = url.toString(); const hit = cache.get(key); if (hit && hit.until > Date.now()) return hit.value;
  const value = (async () => {
    let response: Response;
    try { response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000), headers: { Accept: "application/json", ...(process.env.OPTIONS_API_TOKEN ? { Authorization: `Bearer ${process.env.OPTIONS_API_TOKEN}` } : {}) } }); }
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
  cache.set(key, { until: Date.now() + 10000, value });
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  try { return await value; } catch (e) { if (cache.get(key)?.value === value) cache.delete(key); throw e; }
}
export function params(request: Request) {
  const q = new URL(request.url).searchParams; const p = (q.get("product") ?? "NQ").toUpperCase(); const s = q.get("scope") ?? "0dte";
  if (!["NQ", "ES", "GC"].includes(p) || !["0dte", "d30", "d90", "close"].includes(s)) throw new GoOptionsError("品种或周期参数无效", 400);
  return { product: p as OptionProduct, scope: s as OptionScope, query: q };
}
export async function route(work: () => Promise<unknown>) { try { return Response.json(sanitizePublicData(await work()), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return Response.json(sanitizePublicData({ error: sanitizeDataCopy(e instanceof Error ? e.message : undefined) ?? "期权数据请求失败" }), { status: e instanceof GoOptionsError ? e.status : 502, headers: { "Cache-Control": "no-store" } }); } }
function unifiedAPI() { return process.env.OPTIONS_API_MODE !== "legacy"; }
export async function resolvedUnderlying(product: OptionProduct) {
  const fixed = fixedOptionUnderlying(product);
  if (fixed) return fixed;
  if (unifiedAPI()) {
    const status = object(await upstream("/options/status"));
    const rows = list(status.entries).filter((v) => v.product === product);
    for (const scope of ["0dte", "nearest", "all"] as const) {
      const states = rows.filter((v) => v.scope === scope).sort((a, b) => (number(b.unix) ?? 0) - (number(a.unix) ?? 0));
      if (typeof states[0]?.underlying_symbol === "string") return states[0].underlying_symbol;
    }
  }
  return latestState((await readLevels(product, "0dte")).states)?.underlying_symbol;
}
async function latestStatusUnix(product: OptionProduct, scope: OptionScope, allowNearestFallback = true) {
  try {
    const status = object(await upstream("/options/status"));
    const backend = scope === "d30" || scope === "d90" ? "all" : scope;
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
async function readLevels(product: OptionProduct, scope: OptionScope, from?: number, to?: number, timeframe = 60): Promise<LevelPage> {
  const end = to ?? Math.floor(Date.now() / 30000) * 30 + 1;
  const raw = object(await upstream("/options/levels", { product, scope, from: from ?? end - 3600, to: end, timeframe }));
  return { states: list(raw.states ?? []) as LevelPage["states"], levels: list(raw.levels ?? []) as unknown as LevelPage["levels"] };
}
function backendDashboardScope(scope: OptionScope): string {
  return scope === "d30" || scope === "d90" ? "all" : scope;
}

export async function dashboard(product: OptionProduct, scope: OptionScope, requestedDays?: number, asof?: number) {
  const days = requestedDays ?? (scope === "d90" ? 90 : scope === "d30" ? 30 : scope === "0dte" ? 1 : 45);
  const underlying = await resolvedUnderlying(product);
  if (unifiedAPI()) {
    const readDashboard = async (asofUnix?: number) => {
      const raw = object(await upstream("/options/dashboard", {
        product,
        scope: backendDashboardScope(scope),
        days,
        window_pct: .12,
        current: "true",
        underlying,
        asof: asofUnix,
      }));
      const cells = list((object(raw.heatmap ?? {})).cells ?? []);
      const snapshot = number(raw.snapshot_unix) ?? number(object(raw.market_state ?? {}).unix);
      if (scope === "close" && asofUnix === undefined && !isCurrentPreviousEod(snapshot)) return undefined;
      if (raw.has_data !== false && (cells.length > 0 || raw.summary || raw.market_state)) {
        return { ...raw, product, scope, underlying_symbol: raw.underlying_symbol ?? underlying };
      }
      return undefined;
    };
    let hit: Row | undefined;
    try {
      hit = await readDashboard(asof);
    } catch (error) {
      if (scope === "close" && asof === undefined) {
        return emptyDashboard(product, scope, "前一交易日收盘数据尚未就绪");
      }
      throw error;
    }
    if (hit) return hit;
    if (scope === "close" && asof === undefined) {
      return emptyDashboard(product, scope, "前一交易日收盘数据尚未就绪");
    }
    if (asof === undefined) {
      // A dashboard/heatmap must fall back to the same scope. A newer
      // `nearest` state is not a valid replacement for an older 0DTE surface.
      const snap = await latestStatusUnix(product, scope, false);
      if (snap) {
        const retry = await readDashboard(snap);
        if (retry) return retry;
      }
    }
  }
  if (asof !== undefined && !unifiedAPI()) return emptyDashboard(product, scope, "旧版接口不支持历史期权快照");
  const reason = unsupportedScope(scope);
  if (reason && scope === "close") return emptyDashboard(product, scope, reason);
  const [page, raw] = await Promise.all([
    readLevels(product, scope === "close" ? "0dte" : scope, undefined, undefined, 60).catch(() => ({ states: [], levels: [] })),
    upstream("/options/heatmap", { product, days: Math.max(days, 45), window_pct: .12, underlying }).then(object).catch(() => ({ cells: [], levels: [] })),
  ]);
  const surface = { cells: list(raw.cells ?? []), levels: list(raw.levels ?? []) } as unknown as SurfacePage;
  return composeDashboard(product, scope, page, surface);
}
export async function levels(request: Request) {
  const { product, scope, query } = params(request); const tf = Number(query.get("timeframe") ?? 300); const now = Math.floor(Date.now() / 1000); const to = Number(query.get("to") ?? now + 1), from = Number(query.get("from") ?? now - 3600);
  if (![from, to, tf].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 93 * 86400 || tf < 60 || tf % 60) throw new GoOptionsError("历史时间范围或周期无效", 400);
  if (unifiedAPI()) return upstream("/options/levels", { product, scope, from, to, timeframe: tf, underlying: query.get("underlying") ?? await resolvedUnderlying(product), strict_underlying: "true" });
  const reason = unsupportedScope(scope);
  if (reason) return { product, scope, from, to, timeframe: tf, has_data: false, missing_reason: reason, states: [], levels: [] };
  const page = await readLevels(product, scope, from, to, tf);
  const underlying = latestState(page.states)?.underlying_symbol;
  return { product, scope, from, to, timeframe: tf, source: "options-http", has_data: page.states.length > 0, ...page, states: page.states.filter((s) => s.underlying_symbol === underlying), levels: page.levels.filter((s) => s.underlying_symbol === underlying) };
}
async function latestSnapshot(product: OptionProduct, scope: OptionScope) {
  try {
    const dash = object(await dashboard(product, scope));
    const state = object(dash.market_state ?? {});
    const snap = number(dash.snapshot_unix) ?? number(state.unix);
    const underlying = typeof state.underlying_symbol === "string" ? state.underlying_symbol : await resolvedUnderlying(product);
    if (!snap || !underlying) return undefined;
    return { snap, underlying, dash };
  } catch {
    return undefined;
  }
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

export async function intraday(request: Request) {
  const { product, scope, query } = params(request);
  const optionsOnly = query.get("options_only") === "true";
  const now = Math.floor(Date.now() / 1000);
  const requestedTo = Number(query.get("to") ?? Math.floor(now / 60) * 60 + 1);
  const requestedFrom = Number(query.get("from") ?? requestedTo - 86400);
  const requestedAsof = Number(query.get("asof") ?? requestedTo - 1);
  if (![requestedFrom, requestedTo, requestedAsof].every(Number.isSafeInteger) || requestedFrom <= 0 || requestedTo <= requestedFrom || requestedTo - requestedFrom > 7 * 86400) throw new GoOptionsError("日内历史时间范围无效", 400);
  if (query.get("bars_only") === "true") {
    const underlying = await resolvedUnderlying(product).catch(() => undefined);
    const day = new Date(requestedAsof * 1000).toISOString().slice(0, 10);
    const empty = { product, scope, source: "options-http", day, has_data: false, bars: [], levels: [], current: null, missing_reason: "当前暂无日内行情", underlying_symbol: underlying } as OptionsIntradayResponse;
    if (!underlying) return empty;
    try {
      return finishIntraday(await attachAvailableCandles(empty, product, upstream, undefined, underlying, { from: requestedFrom, to: requestedTo }));
    } catch (error) {
      return finishIntraday({ ...empty, candle_notice: error instanceof Error ? error.message : "K线读取失败" });
    }
  }
  // close 直接读取后端 EOD intraday；不得先用盘中 0DTE dashboard 构造同名快照。
  const live = scope === "close" ? undefined : await latestSnapshot(product, scope);
  const statusSnap = !live && scope !== "close" ? await latestStatusUnix(product, scope) : undefined;
  const underlying = live?.underlying ?? await resolvedUnderlying(product).catch(() => undefined);
  const snap = live?.snap ?? statusSnap;
  const from = snap && requestedTo < snap - 3600 ? snap - 86400 : requestedFrom;
  const to = snap && requestedTo < snap - 3600 ? snap + 3600 : Math.max(requestedTo, snap ? snap + 3600 : requestedTo);
  const asof = snap && (requestedAsof < snap - 7 * 86400 || requestedAsof > snap + 86400) ? snap : requestedAsof;
  if (![from, to, asof].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 7 * 86400) throw new GoOptionsError("日内历史时间范围无效", 400);
  const day = new Date((snap ?? asof) * 1000).toISOString().slice(0, 10);
  const empty = { product, scope, source: "options-http", day, has_data: false, bars: [], levels: [], current: null, missing_reason: "当前暂无日内行情", underlying_symbol: underlying } as OptionsIntradayResponse;
  let data = await unavailableEndpoint("/options/intraday", { product, scope, from, to, asof, underlying }, empty) as OptionsIntradayResponse;
  if (!unifiedAPI()) return data;
  if (scope === "close") {
    const captured = number(data.current?.captured_at) ?? number((data as unknown as Row).snapshot_unix);
    if (!isCurrentPreviousEod(captured)) {
      return finishIntraday({
        ...empty,
        underlying_symbol: underlying,
        candle_underlying_symbol: underlying,
        missing_reason: "前一交易日收盘数据尚未就绪",
      });
    }
  }
  const candleRange = { from, to };
  if (!optionsOnly) try {
    data = await attachAvailableCandles(data, product, upstream, snap, underlying ?? data.underlying_symbol, candleRange);
  } catch (error) {
    data = { ...data, candle_notice: error instanceof Error ? error.message : "K线读取失败" };
  }
  if (!optionsOnly && !(data.bars?.length) && snap && underlying) {
    const fallback = { from: snap - 86400, to: snap + 3600 };
    data = await unavailableEndpoint("/options/intraday", { product, scope, from: fallback.from, to: fallback.to, asof: snap, underlying }, data) as OptionsIntradayResponse;
    try {
      data = await attachAvailableCandles(data, product, upstream, snap, underlying, fallback);
    } catch { /* keep whatever bars we already have */ }
  }
  if (!data.current && live?.dash) data = { ...data, current: currentFromDashboard(live.dash) };
  if (optionsOnly && data.bars?.length) data = { ...data, bars: [] };
  if ((data.bars?.length ?? 0) > 0) data = { ...data, has_data: true, missing_reason: undefined };
  if (underlying) {
    data.underlying_symbol ??= underlying;
    data.candle_underlying_symbol ??= underlying;
  }
  return finishIntraday(data);
}
function finishIntraday(data: OptionsIntradayResponse): OptionsIntradayResponse {
  if (typeof data.candle_notice === "string") data.candle_notice = sanitizeDataCopy(data.candle_notice);
  return data;
}
export async function optionVolumeProfile(request: Request) {
  const { product, query } = params(request);
  const from = Number(query.get("from"));
  const to = Number(query.get("to"));
  if (![from, to].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 7 * 86400) {
    throw new GoOptionsError("期权成交量时间范围无效", 400);
  }
  const live = await latestSnapshot(product, "0dte");
  const empty = {
    product, scope: "0dte" as const, from, to, source_from: from, source_to: to, fallback: false, fallback_days: 0,
    underlying_symbol: live?.underlying, has_data: false, rows: [],
  };
  const read = async (rangeFrom: number, rangeTo: number) => {
    const raw = object(await unavailableEndpoint("/options/0dte-volume-profile", { product, from: rangeFrom, to: rangeTo, underlying: live?.underlying }, { rows: [] }));
    return list(raw.rows ?? []);
  };
  let rows: Row[] = [];
  let sourceFrom = from;
  let sourceTo = to;
  let fallbackDays = 0;
  let fallback = false;
  try { rows = await read(from, to); } catch { return empty; }
  if (!rows.length && live?.snap) {
    fallback = true;
    sourceFrom = live.snap - 86400;
    sourceTo = live.snap + 3600;
    rows = await read(sourceFrom, sourceTo);
  }
  if (!rows.length) {
    fallback = true;
    const baseDay = cmeTradingDayAt((live?.snap ?? to) - 1);
    for (let offset = 0; offset <= 7; offset++) {
      const day = shiftDay(baseDay, -offset);
      const nextDay = shiftDay(day, 1);
      sourceFrom = sessionStart(day);
      sourceTo = sessionStart(nextDay);
      rows = await read(sourceFrom, sourceTo);
      if (rows.length) { fallbackDays = offset; break; }
    }
  }
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
    underlying_symbol: live?.underlying,
    has_data: byStrike.size > 0,
    rows: [...byStrike.values()].sort((a, b) => b.strike - a.strike),
  };
}
export async function optionStats(request: Request) {
  const { product, query } = params(request);
  const from = Number(query.get("from"));
  const to = Number(query.get("to"));
  const timeframe = Number(query.get("timeframe"));
  const allowedTimeframes = new Set([60, 300, 900, 1800, 3600]);
  if (![from, to, timeframe].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 7 * 86400 || !allowedTimeframes.has(timeframe)) {
    throw new GoOptionsError("期权 Stats 时间范围或周期无效", 400);
  }
  const live = await latestSnapshot(product, "0dte");
  const empty = { product, scope: "0dte", from, to, timeframe, window_mode: "session_open_expected_move", has_data: false, points: [] };
  let data = object(await unavailableEndpoint("/options/stats", { product, from, to, timeframe, underlying: live?.underlying }, empty));
  const points = list(data.points ?? []);
  if (points.length === 0 && live?.snap) {
    data = object(await unavailableEndpoint("/options/stats", {
      product, from: live.snap - 86400, to: live.snap + 3600, timeframe, underlying: live.underlying,
    }, empty));
  }
  return data;
}
export async function chain(request: Request) {
  const { product, scope, query } = params(request);
  const expirationRaw = Number(query.get("expiration"));
  const expiration = Number.isSafeInteger(expirationRaw) && expirationRaw > 0 ? expirationRaw : undefined;
  const underlying = await resolvedUnderlying(product);
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
  }, empty)) as OptionsChainResponse & Row;
  const liveRows = live.chain && typeof live.chain === "object" ? list((live.chain as unknown as Row).rows ?? []) : [];
  if (live.has_data !== false && liveRows.length > 0) return { ...live, product, scope };
  if (scope === "close") return { ...empty, missing_reason: "暂无完整的收盘数据" };
  try {
    return composeChainFromDashboard(await dashboard(product, scope) as OptionsDashboardResponse, product, scope, expiration);
  } catch {
    return {
      ...empty,
      missing_reason: typeof live.missing_reason === "string" ? live.missing_reason : empty.missing_reason,
    };
  }
}
export async function term(request: Request) {
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
  if (scope === "close") return { ...empty, missing_reason: "暂无完整的收盘数据" };
  const data = object(await unavailableEndpoint("/options/term", { product, scope: backendDashboardScope(scope) }, empty));
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

  let dash = object(await dashboard(product, scope));
  let fromDash = mapExpiries(dash);
  let notice = "IV / PCR 来自看板到期汇总";
  if (fromDash.length < 2 && scope === "0dte") {
    const wider = object(await dashboard(product, "d90"));
    const widerPoints = mapExpiries(wider);
    if (widerPoints.length > fromDash.length) {
      dash = wider;
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
export async function unavailableEndpoint(path: string, query: Record<string, string | number | undefined>, empty: unknown) {
  try { return await upstream(path, query); }
  catch (error) { if (error instanceof GoOptionsError && error.status === 404) return empty; throw error; }
}
export async function sourceStatus() {
  if (unifiedAPI()) {
    const status = object(await upstream("/options/status"));
    return { ...status, entries: list(status.entries).filter(allowedStatusEntry) };
  }
  const groups = await Promise.all((["NQ", "ES", "GC"] as const).flatMap((product) => (["0dte", "d90"] as const).map(async (scope) => {
    const state = latestState((await readLevels(product, scope)).states);
    return state ? [{ product, scope, unix: state.unix, source_unix: number(state.source_unix) ?? state.unix, underlying_symbol: state.underlying_symbol, quality_flags: state.quality_flags ?? 0 }] : [];
  })));
  return { source: "options-http", checked_at: Math.floor(Date.now() / 1000), poll_interval_sec: 60, entries: groups.flat() };
}
