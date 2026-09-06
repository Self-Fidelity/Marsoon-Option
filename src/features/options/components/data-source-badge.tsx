"use client";

import { useQuery } from "@tanstack/react-query";

import { formatSnapshotTime } from "@/lib/formatters";

import {
  formatCountdown,
  ingestStatusQueryOptions,
  nextUpdateRemainingMs,
  useNowMs,
} from "../ingest-status";

/**
 * 数据源状态徽标：显示 Barchart 采集器是否存活，以及距下次自动抓取的倒计时。
 * 数据为延迟行情（>=15min），故常态标注"延迟"。
 */
export function DataSourceBadge() {
  const statusQuery = useQuery(ingestStatusQueryOptions);
  const now = useNowMs(1000);

  const status = statusQuery.data;
  if (!status || !status.ok || status.capturedAt === null) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] text-[var(--ms-text-tertiary)]">
        <span className="size-1.5 rounded-full bg-[var(--ms-text-tertiary)]" />
        数据尚未就绪
      </span>
    );
  }

  const ageMs = now - status.capturedAt;
  const intervalMs = status.intervalSec * 1000;
  const remainingMs = nextUpdateRemainingMs(status, now);

  if (ageMs > intervalMs * 3) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] text-[var(--ms-danger)]">
        <span className="size-1.5 rounded-full bg-[var(--ms-danger)]" />
        抓取失活 · {Math.floor(ageMs / 60_000)}分钟前
      </span>
    );
  }

  const isStale = ageMs > intervalMs * 1.5;
  return (
    <span
      className={`flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] ${
        isStale ? "text-[var(--ms-brand)]" : "text-[var(--ms-buy)]"
      }`}
      title={`延迟行情 · 更新周期 ${status.intervalSec}s · 已更新 ${status.ingestCount} 次`}
    >
      <span
        className={`size-1.5 rounded-full ${
          isStale ? "bg-[var(--ms-brand)]" : "bg-[var(--ms-buy)] animate-pulse"
        }`}
      />
      {isStale ? "STALE" : "LIVE"} · 延迟15min · {remainingMs > 0 ? `下次更新 ${formatCountdown(remainingMs)}` : "更新中…"}
    </span>
  );
}

type StatusTone = "ok" | "warn" | "danger" | "idle";

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-[var(--ms-buy)] animate-pulse",
  warn: "bg-[var(--ms-brand)]",
  danger: "bg-[var(--ms-danger)]",
  idle: "bg-[var(--ms-text-tertiary)]",
};

const TONE_RANK: Record<StatusTone, number> = { ok: 0, idle: 0, warn: 1, danger: 2 };

/**
 * 顶栏状态圆点（布局极致简约化 D）：顶栏状态文本全部收进一个圆点——
 * 绿=正常 / 黄=stale（快照或采集任一滞后）/ 红=抓取失活或接口错误 / 灰=未接入实时源（DEMO）。
 * hover 浮出 tooltip 展开原有全部详情（快照状态/时间、采集存活、延迟口径、下次更新倒计时、
 * 采集周期与推送次数），信息零丢失；取快照侧与采集侧的较差者定色。
 */
export function StatusDot({
  snapshotLabel,
  snapshotUnix,
  snapshotTone,
}: {
  /** 快照状态文字（FRESH/STALE/LOADING/ERROR/DEMO/--），进 tooltip 第一行 */
  snapshotLabel: string;
  snapshotUnix?: number;
  /** 快照侧灯色（由 viewModel.status / pending / error 推导） */
  snapshotTone: StatusTone;
}) {
  const statusQuery = useQuery(ingestStatusQueryOptions);
  const now = useNowMs(1000);
  const status = statusQuery.data;

  let ingestTone: StatusTone = "idle";
  let ingestLine = "数据尚未就绪";
  let detailLine: string | null = null;
  if (status && status.ok && status.capturedAt !== null) {
    const ageMs = now - status.capturedAt;
    const intervalMs = status.intervalSec * 1000;
    detailLine = `延迟行情 · 更新周期 ${status.intervalSec}s · 已更新 ${status.ingestCount} 次`;
    if (ageMs > intervalMs * 3) {
      ingestTone = "danger";
      ingestLine = `抓取失活 · ${Math.floor(ageMs / 60_000)}分钟前`;
    } else {
      const isStale = ageMs > intervalMs * 1.5;
      const remainingMs = nextUpdateRemainingMs(status, now);
      ingestTone = isStale ? "warn" : "ok";
      ingestLine = `${isStale ? "STALE" : "LIVE"} · 延迟15min · ${remainingMs > 0 ? `下次更新 ${formatCountdown(remainingMs)}` : "更新中…"}`;
    }
  }

  const tone: StatusTone =
    TONE_RANK[snapshotTone] > TONE_RANK[ingestTone] ? snapshotTone : ingestTone;

  return (
    <span className="group relative flex items-center" tabIndex={0} aria-label={`数据状态：${snapshotLabel}；${ingestLine}`}>
      <span className={`size-2 rounded-full ${TONE_DOT[tone]}`} />
      {/* hover tooltip：直角浮层，展开原有全部状态详情 */}
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-max max-w-72 flex-col gap-1 border border-[var(--ms-separator)] bg-[var(--ms-panel-bg)] px-3 py-2 text-left font-mono text-[9px] leading-4 tracking-[0.04em] shadow-lg group-hover:flex group-focus-within:flex">
        <span className="text-[var(--ms-text-primary)]">
          SNAPSHOT · {snapshotLabel} · {formatSnapshotTime(snapshotUnix)}
        </span>
        <span className={ingestTone === "danger" ? "text-[var(--ms-danger)]" : "text-[var(--ms-text-secondary)]"}>
          {ingestLine}
        </span>
        {detailLine ? <span className="text-[var(--ms-text-tertiary)]">{detailLine}</span> : null}
      </span>
    </span>
  );
}
