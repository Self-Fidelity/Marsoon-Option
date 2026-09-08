"use client";

import { useEffect } from "react";

import {
  ACTIVITY_KEYS,
  ACTIVITY_RETRY_DELAY_MS,
  completeActivityEvent,
  pendingActivityEvent,
  shouldReportActivity,
} from "./client-activity-state";

type SessionResponse = { authenticated?: boolean; user?: { id?: unknown } | null };

/** One reporter for the whole app shell; route transitions must not create sessions. */
export function ClientActivityReporter({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void report(true);
      }, ACTIVITY_RETRY_DELAY_MS);
    };

    const report = async (force: boolean) => {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      const lastReportedAt = Number(localStorage.getItem(ACTIVITY_KEYS.lastReportedAt) ?? 0);
      if (!force && !shouldReportActivity(lastReportedAt)) return;
      inFlight = true;
      try {
        // Refreshes a near-expiry access token while keeping it inside HttpOnly cookies.
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
        if (!sessionResponse.ok) {
          if (sessionResponse.status >= 500) scheduleRetry();
          return;
        }
        const session = await sessionResponse.json() as SessionResponse;
        const userId = typeof session.user?.id === "string" ? session.user.id : "";
        if (!session.authenticated || !userId) return;
        const eventId = pendingActivityEvent(localStorage, userId, () => crypto.randomUUID());
        const response = await fetch("/api/auth/activity", {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ event_id: eventId }),
        });
        if (!response.ok) throw new Error("activity failed");
        completeActivityEvent(localStorage);
      } catch {
        // The persisted event id is reused after reconnect or the retry delay.
        scheduleRetry();
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => { if (document.visibilityState === "visible") void report(false); };
    const onOnline = () => { if (localStorage.getItem(ACTIVITY_KEYS.pendingEvent)) void report(true); };
    void report(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);

  return null;
}
