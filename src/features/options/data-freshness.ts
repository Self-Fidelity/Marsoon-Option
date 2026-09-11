"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { cmeTradingDayKey, isCmeSessionOpen } from "@/lib/cme-session";

/**
 * 数据新鲜度与失效驱动：全部来自 Go 期权服务。
 *
 * 全站只轮询一个极轻的版本端点（30s，React Query 同 key 去重）。
 * 调度器（2026-09-11《K线与期权数据周期管理与防堵塞设计》§3.3）：
 * 版本失效按 (product, scope) 粒度——哪个 scope 出新快照只失效哪个 scope 的查询，
 * 不再全局一个 v 拖着 d30/d90 大快照每分钟重拉。
 * 各档消费节奏 + 相位错位（§3.2），每拍最多放行 2 个 scope，
 * 失败按 scope 指数退避（1→2→4→5 分钟封顶）。不做降频：定时节奏恒定，
 * 拥堵由重车道优先级消化（K线 > 0DTE > 其他）。
 * 诊断只进 console.debug（[ms-data] 前缀），不向 UI 暴露。
 */

/** 后端实测快照刷新周期（秒）：0dte/nearest 60s，d30/d90 300s，close 每日一次。 */
export const SCOPE_REFRESH_SEC: Record<string, number> = {
  "0dte": 60,
  nearest: 60,
  d30: 300,
  d90: 300,
  all: 300,
  close: 86_400,
};

/** 前端消费节奏（§3.2）：可比后端产出慢，不无意义地快。 */
const SCOPE_CONSUME_MS: Record<string, number> = {
  "0dte": 60_000,
  nearest: 60_000,
  all: 300_000,
  d30: 3_600_000,
  d90: 3_600_000,
  close: 86_400_000,
};

/**
 * 调度消费节奏对外的 staleTime 口径（2026-09-11 首屏提速）：
 * 各 hook 的 staleTime 与本节奏对齐——挂载/恢复不再自作主张比后端产出更勤地重拉，
 * 是否重拉由调度器比对 version unix 裁决。这是本地持久化快照能"秒开且不误拉"的前提。
 */
export function scopeStaleTimeMs(scope: string): number {
  return SCOPE_CONSUME_MS[scope] ?? 30_000;
}

/** 相位偏移（§3.2）：60|3600 整除关系下各档永不撞车；开机按相位错开，消灭启动惊群。 */
const SCOPE_PHASE_MS: Record<string, number> = {
  "0dte": 5_000,
  nearest: 5_000,
  all: 41_000,
  d30: 7 * 60_000,
  d90: 23 * 60_000,
  close: 0,
};

/** 一拍（30s）最多放行的 scope 数：其余保持到期态等下一拍，慢查询天然被摊平。 */
const MAX_RELEASE_PER_TICK = 2;
/** 放行优先级：0dte 最新鲜优先。 */
const SCOPE_ORDER = ["0dte", "nearest", "all", "d30", "d90", "close"];

export interface DataVersionEntry {
  product: string;
  scope: string;
  unix: number;
}

export interface DataVersion {
  v: string;
  entries: DataVersionEntry[];
}

export const dataVersionQueryOptions = {
  queryKey: ["options-data-version"] as const,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<DataVersion> => {
    const res = await fetch("/api/options/version", {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("数据版本读取失败");
    const body = (await res.json()) as DataVersion;
    if (!body || typeof body.v !== "string" || !Array.isArray(body.entries)) {
      throw new Error("数据版本响应无效");
    }
    return body;
  },
  refetchInterval: () => (isCmeSessionOpen() ? 30_000 : 300_000),
  staleTime: 10_000,
};

interface ScopeState {
  unix: number;
  nextDueAt: number;
  failCount: number;
  /** EOD 单拉（§3.7）：close 档每交易日最多消费一次的交易日标记。 */
  fetchedDay?: string;
}

/** 每个 (product, scope) 的调度状态：上次已消费的 unix、下次到期时间、连续失败计数。 */
const scopeStates = new Map<string, ScopeState>();

/**
 * 调度状态跨会话持久化（2026-09-11 首屏提速）：
 * 重开页面后拿本地记录的已消费 unix 与 version 端点比对——没变就一次重拉都不发
 * （配合 IndexedDB 快照恢复，EOD/K线秒开的关键）；变了第一拍立刻补拉。
 */
const SCOPE_STATES_STORAGE_KEY = "marsoon-scope-states-v1";

function loadScopeStates() {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(SCOPE_STATES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { unix?: unknown; fetchedDay?: unknown }>;
    for (const [id, saved] of Object.entries(parsed)) {
      if (typeof saved?.unix !== "number") continue;
      // nextDueAt 归零：首拍立即参与比对——unix 一致直接跳过，不一致马上补拉
      scopeStates.set(id, {
        unix: saved.unix,
        nextDueAt: 0,
        failCount: 0,
        ...(typeof saved.fetchedDay === "string" ? { fetchedDay: saved.fetchedDay } : {}),
      });
    }
  } catch {
    // 记录损坏即弃，按全新调度起步
  }
}
loadScopeStates();

function saveScopeStates() {
  if (typeof localStorage === "undefined") return;
  try {
    const out: Record<string, { unix: number; fetchedDay?: string }> = {};
    for (const [id, state] of scopeStates) {
      out[id] = { unix: state.unix, ...(state.fetchedDay ? { fetchedDay: state.fetchedDay } : {}) };
    }
    localStorage.setItem(SCOPE_STATES_STORAGE_KEY, JSON.stringify(out));
  } catch {
    // 配额满等异常静默
  }
}

/** ±10% 抖动：多 tab/多用户不共振。 */
function jitter(range: number) {
  return range * (Math.random() * 0.2 - 0.1);
}

/** query key → 调度粒度 id（`${product}:${scope}`）；不认识的 key 返回 null（不参与调度）。 */
function scopeIdOfKey(key: readonly unknown[]): string | null {
  switch (String(key[0])) {
    case "options-dashboard":
    case "options-levels":
    case "options-term":
      return `${String(key[1])}:${String(key[2])}`;
    case "options-chain":
      return `${String(key[1])}:${String(key[3])}`;
    case "option-volume-profile":
      return `${String(key[1])}:0dte`;
    default:
      return null;
  }
}

const isVersionQuery = (key: readonly unknown[]) =>
  String(key[0]) === dataVersionQueryOptions.queryKey[0];
/**
 * K 线与日内查询不走版本失效：这一族（bars 整窗 / bars 尾部 / intraday 明细）
 * 已改为各自的固定节奏自刷新（整窗拉一次、尾部 60s 对齐整分、明细按档分频）。
 */
const isSelfRefreshingIntraday = (key: readonly unknown[]) => String(key[0]) === "options-intraday";

/** 该调度粒度下缓存里最新一次成功取数时间；无缓存返回 null。 */
function freshestDataUpdatedAt(queryClient: ReturnType<typeof useQueryClient>, id: string): number | null {
  let latest: number | null = null;
  for (const query of queryClient.getQueryCache().findAll()) {
    if (scopeIdOfKey(query.queryKey) !== id) continue;
    if (query.state.status !== "success" || query.state.data === undefined) continue;
    if (latest == null || query.state.dataUpdatedAt > latest) latest = query.state.dataUpdatedAt;
  }
  return latest;
}

export function useSnapshotSync() {
  const queryClient = useQueryClient();
  const versionQuery = useQuery(dataVersionQueryOptions);
  const tick = versionQuery.dataUpdatedAt;

  useEffect(() => {
    const entries = versionQuery.data?.entries;
    if (!entries) return;
    // 后台标签页不做任何失效/重试：面板不可见时没有渲染收益，只会给后端加压。
    if (typeof document !== "undefined" && document.hidden) return;
    // 休市总闸（§3.5）：重车道全停，version 心跳照旧；开市后下一拍正常调度。
    if (!isCmeSessionOpen()) return;

    const now = Date.now();

    // 当前处于 error 的 scope（保险丝语义并入退避：失败 scope 到期后允许重试，
    // 但重试间隔按失败次数指数增长，不再每 30s 无差别重试）
    const erroredScopes = new Set<string>();
    for (const query of queryClient.getQueryCache().findAll()) {
      if (query.state.status !== "error") continue;
      const id = scopeIdOfKey(query.queryKey);
      if (id) erroredScopes.add(id);
    }

    const due: string[] = [];
    for (const entry of entries) {
      const id = `${entry.product}:${entry.scope}`;
      const base = SCOPE_CONSUME_MS[entry.scope] ?? 300_000;
      let state = scopeStates.get(id);
      if (!state) {
        // 初见：挂载查询自己会拉首次，这里只记基线 unix、按相位定首拍。
        // 例外（2026-09-11 持久化配套）：命中本地恢复快照时挂载查询可能不再拉取，
        // 若缓存取数时间早于 version 快照 unix（离开期间快照已推进），
        // 首拍强制补拉一次而不是盲记基线，否则旧数据会永久挂住。
        const cachedAt = freshestDataUpdatedAt(queryClient, id);
        const cacheCoversSnapshot = cachedAt != null && cachedAt >= entry.unix * 1000;
        state = {
          unix: cacheCoversSnapshot ? entry.unix : -1,
          nextDueAt: now + (SCOPE_PHASE_MS[entry.scope] ?? 0) + Math.abs(jitter(base)),
          failCount: 0,
        };
        scopeStates.set(id, state);
        continue;
      }
      if (now < state.nextDueAt) continue;
      if (entry.unix === state.unix && !erroredScopes.has(id)) continue;
      // EOD 单拉（§3.7）：close 档每交易日最多消费一次——当日内 unix 再变
      // （结算修正/重发）也不重复拉取；失败重试由退避机制管。
      if (entry.scope === "close" && state.fetchedDay === cmeTradingDayKey(now)) continue;
      due.push(id);
    }

    due.sort(
      (a, b) =>
        SCOPE_ORDER.indexOf(a.split(":")[1]!) - SCOPE_ORDER.indexOf(b.split(":")[1]!),
    );
    const released = due.slice(0, MAX_RELEASE_PER_TICK);
    if (due.length > released.length) {
      console.debug(`[ms-data] 本拍放行 ${released.length}/${due.length} 个 scope，其余等下一拍`);
    }

    for (const id of released) {
      const state = scopeStates.get(id)!;
      const entry = entries.find((e) => `${e.product}:${e.scope}` === id)!;
      const base = SCOPE_CONSUME_MS[entry.scope] ?? 300_000;
      const hadError = erroredScopes.has(id);
      state.unix = entry.unix;
      if (entry.scope === "close") state.fetchedDay = cmeTradingDayKey(now);
      if (hadError) {
        state.failCount += 1;
        const backoff = Math.min(300_000, 30_000 * 2 ** Math.min(state.failCount, 4));
        state.nextDueAt = now + backoff + Math.abs(jitter(backoff));
        console.debug(`[ms-data] ${id} 失败重试，第 ${state.failCount} 次退避 ${Math.round(backoff / 1000)}s`);
      } else {
        state.failCount = 0;
        state.nextDueAt = now + base + jitter(base);
      }
      void queryClient.invalidateQueries({
        predicate: (query) =>
          scopeIdOfKey(query.queryKey) === id &&
          !isVersionQuery(query.queryKey) &&
          !isSelfRefreshingIntraday(query.queryKey) &&
          Date.now() - query.state.dataUpdatedAt >= 10_000,
      });
    }

    saveScopeStates();
  }, [versionQuery.data, tick, queryClient]);
}
