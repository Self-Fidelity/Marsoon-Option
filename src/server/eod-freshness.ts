import { lastCompletedEodAsof } from "@/lib/cme-session";

/** Previous-EOD labels may only consume the immediately preceding completed CME session. */
export function isCurrentPreviousEod(snapshotUnix: number | null | undefined, nowMs = Date.now()): boolean {
  if (typeof snapshotUnix !== "number" || !Number.isSafeInteger(snapshotUnix) || snapshotUnix <= 0) return false;
  return Math.abs(snapshotUnix - lastCompletedEodAsof(nowMs)) < 60;
}
