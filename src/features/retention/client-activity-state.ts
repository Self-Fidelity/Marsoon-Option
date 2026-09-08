export const ACTIVITY_KEYS = {
  pendingEvent: "marsoon.pending-activity-event",
  pendingUser: "marsoon.pending-activity-user",
  lastReportedAt: "marsoon.last-activity-at",
} as const;

export const ACTIVITY_RESUME_INTERVAL_MS = 30 * 60 * 1000;
export const ACTIVITY_RETRY_DELAY_MS = 30 * 1000;

type ActivityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function shouldReportActivity(lastReportedAt: number, now = Date.now()) {
  return !Number.isFinite(lastReportedAt) || lastReportedAt <= 0 || now - lastReportedAt >= ACTIVITY_RESUME_INTERVAL_MS;
}

export function pendingActivityEvent(storage: ActivityStorage, userId: string, createId: () => string) {
  const storedUser = storage.getItem(ACTIVITY_KEYS.pendingUser);
  if (storedUser !== userId) {
    storage.removeItem(ACTIVITY_KEYS.pendingEvent);
    storage.setItem(ACTIVITY_KEYS.pendingUser, userId);
  }
  const existing = storage.getItem(ACTIVITY_KEYS.pendingEvent)?.trim();
  if (existing) return existing;
  const eventId = createId();
  storage.setItem(ACTIVITY_KEYS.pendingEvent, eventId);
  return eventId;
}

export function completeActivityEvent(storage: ActivityStorage, now = Date.now()) {
  storage.removeItem(ACTIVITY_KEYS.pendingEvent);
  storage.removeItem(ACTIVITY_KEYS.pendingUser);
  storage.setItem(ACTIVITY_KEYS.lastReportedAt, String(now));
}
