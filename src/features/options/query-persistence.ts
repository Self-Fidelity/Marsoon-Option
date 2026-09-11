"use client";

import type { Query, QueryClient } from "@tanstack/react-query";

/**
 * 大快照本地持久化（2026-09-11 首屏提速）。
 *
 * 背景：React Query 缓存是纯内存，刷新页面后 close 档快照（~900KB）、K线整窗（~142KB）
 * 等全部要重拉，而 Go 重聚合常态 25~60s——每次刷新都干等。
 * 这里把白名单查询族持久化到 IndexedDB：下次启动先把旧快照灌回缓存立即渲染，
 * 是否真需要重拉由调度器（data-freshness.ts）比对 version unix 裁决——
 * unix 没变就一次重请求都不发，变了才后台失效重拉（页面上始终有画面）。
 *
 * 失败即静默降级：持久化是纯增强，任何一步出错都不影响主流程。
 */

const DB_NAME = "marsoon-query-cache";
const DB_VERSION = 1;
const STORE = "queries";

/** 记录最长寿命：隔夜快照只用于"先有画面"，超过一天直接丢弃重拉。 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 参与持久化的查询族（大快照/重接口）；version、鉴权等轻量查询不入库。 */
const PERSISTED_PREFIXES = new Set([
  "options-dashboard",
  "options-intraday",
  "options-levels",
  "options-term",
  "options-chain",
  "option-volume-profile",
]);

function shouldPersist(query: Query): boolean {
  const key = query.queryKey;
  if (!PERSISTED_PREFIXES.has(String(key[0]))) return false;
  // bars-tail 是 30 分钟尾部小窗、每分钟重写，恢复价值为零
  if (key[0] === "options-intraday" && key[1] === "bars-tail") return false;
  return query.state.status === "success" && query.state.data !== undefined;
}

interface PersistedRecord {
  queryKey: unknown[];
  data: unknown;
  dataUpdatedAt: number;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idOf(key: unknown[]): string {
  return JSON.stringify(key);
}

/** 启动时把未过期记录灌回 QueryClient；已存在更新的数据时不覆盖。 */
export async function restoreQueryCache(queryClient: QueryClient): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  if (!db) return;
  try {
    const records = await new Promise<Array<[string, PersistedRecord]>>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const keys = keysReq.result.map(String);
        const vals = valsReq.result as PersistedRecord[];
        resolve(keys.map((k, i) => [k, vals[i]!]));
      };
      tx.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
    const now = Date.now();
    const expired: string[] = [];
    let restored = 0;
    for (const [id, record] of records) {
      if (
        !record ||
        !Array.isArray(record.queryKey) ||
        typeof record.savedAt !== "number" ||
        now - record.savedAt > MAX_AGE_MS
      ) {
        expired.push(id);
        continue;
      }
      const existing = queryClient.getQueryState(record.queryKey);
      if (existing && existing.dataUpdatedAt > record.dataUpdatedAt) continue;
      queryClient.setQueryData(record.queryKey, record.data, { updatedAt: record.dataUpdatedAt });
      restored += 1;
    }
    if (restored > 0) console.debug(`[ms-data] 本地快照恢复 ${restored} 条`);
    if (expired.length > 0) {
      const tx = db.transaction(STORE, "readwrite");
      for (const id of expired) tx.objectStore(STORE).delete(id);
    }
  } catch {
    // 静默降级
  }
}

/** 订阅 QueryCache：白名单查询成功后防抖落库；查询被移除时同步删库。返回退订函数。 */
export function persistQueryCache(queryClient: QueryClient): () => void {
  if (typeof indexedDB === "undefined") return () => {};
  const dbPromise = openDb();
  const pending = new Map<string, PersistedRecord>();
  const removed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (!pending.size && !removed.size) return;
    const writes = [...pending.entries()];
    const deletes = [...removed];
    pending.clear();
    removed.clear();
    void dbPromise.then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const [id, record] of writes) store.put(record, id);
        for (const id of deletes) store.delete(id);
      } catch {
        // 静默降级
      }
    });
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flush, 1_000);
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success" && shouldPersist(event.query)) {
      const key = event.query.queryKey as unknown[];
      pending.set(idOf(key), {
        queryKey: key,
        data: event.query.state.data,
        dataUpdatedAt: event.query.state.dataUpdatedAt,
        savedAt: Date.now(),
      });
      schedule();
      return;
    }
    if (event.type === "removed") {
      const key = event.query.queryKey as unknown[];
      if (!PERSISTED_PREFIXES.has(String(key[0]))) return;
      const id = idOf(key);
      pending.delete(id);
      removed.add(id);
      schedule();
    }
  });

  // 标签页隐藏时立即落盘，避免防抖窗口内的更新随关闭丢失
  const onHidden = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onHidden);
    if (timer) clearTimeout(timer);
    flush();
  };
}
