"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * R3 前端请求收敛：快照版本（capturedAt）驱动的失效模型。
 * 全站只轮询一个轻量状态端点（30s，React Query 同 key 去重），
 * capturedAt 变化才 invalidate 全部活跃查询——同一快照版本下各面板
 * 不再各自 60s 错相位轮询，同版本零重复请求。
 */

export interface IngestStatus {
  ok: boolean;
  capturedAt: number | null;
  lastIngestAt: number | null;
  intervalSec: number;
  ingestCount: number;
  lastError: string | null;
  products: Array<{
    product: string;
    symbol: string | null;
    strikes: number;
    lastPrice: number | null;
  }>;
}

/** 与 DataSourceBadge 共享同一 queryKey/queryFn：全站只有一份轮询 */
export const ingestStatusQueryOptions = {
  queryKey: ["ingest-barchart-status"] as const,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<IngestStatus> => {
    const res = await fetch("/api/ingest/barchart", {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("状态读取失败");
    return (await res.json()) as IngestStatus;
  },
  refetchInterval: 30_000,
  staleTime: 10_000,
};

/**
 * 在看板/首页挂载一次：capturedAt 变化 → 失效所有活跃查询（有界：仅当前挂载的）。
 * 无快照（null）不动作，避免冷启动抖动。
 */
export function useSnapshotSync() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(ingestStatusQueryOptions);
  const capturedAt = statusQuery.data?.capturedAt ?? null;
  useEffect(() => {
    if (capturedAt === null) return;
    void queryClient.invalidateQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在快照版本变化时失效
  }, [capturedAt, queryClient]);
}

/** 每秒 tick 的当前时间戳（ms），组件卸载清理 */
export function useNowMs(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 距下次采集的剩余毫秒：capturedAt + intervalSec - now（全站唯一口径） */
export function nextUpdateRemainingMs(status: IngestStatus, now: number): number {
  return (status.capturedAt ?? 0) + status.intervalSec * 1000 - now;
}

/** mm:ss 格式化（负值钳 0） */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 顶栏"下次更新"倒计时的共享 hook（06 面板 SPOT 牌第二行复用，更新机制改时两边自动同步）。
 * 返回 "07:53" / 到点 "更新中…"；无状态或采集器未接入返回 null。
 */
export function useNextUpdateCountdown(): string | null {
  const statusQuery = useQuery(ingestStatusQueryOptions);
  const now = useNowMs(1000);
  const status = statusQuery.data;
  if (!status || !status.ok || status.capturedAt === null) return null;
  const remaining = nextUpdateRemainingMs(status, now);
  return remaining > 0 ? formatCountdown(remaining) : "更新中…";
}
