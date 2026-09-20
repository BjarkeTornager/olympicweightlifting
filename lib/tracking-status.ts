export type BudgetState =
  "ok" | "low" | "exhausted" | "unknown" | "unconfigured";
export function budgetState(value: unknown): BudgetState {
  if (!value || typeof value !== "object") return "unknown";
  const { limit, limit_remaining: remaining } = value as Record<
    string,
    unknown
  >;
  if (remaining === null) return "ok";
  if (typeof remaining !== "number" || !Number.isFinite(remaining))
    return "unknown";
  if (remaining <= 0) return "exhausted";
  return typeof limit === "number" && limit > 0 && remaining / limit <= 0.1
    ? "low"
    : "ok";
}
export type TrackingNotice = { code: string; message: string; route: string };
export function trackingNotices(input: {
  health?: { last_result: string | null };
  reminder?: { enabled: boolean; last_status: string | null };
  remindersConfigured: boolean;
  budget: BudgetState;
}) {
  const notices: TrackingNotice[] = [];
  if (input.health?.last_result === "failed")
    notices.push({
      code: "sleep_failed",
      message:
        "Your latest sleep import failed. Run the Shortcut while your iPhone is unlocked, then check the connection.",
      route: "data/sleep",
    });
  if (input.reminder?.last_status === "expired")
    notices.push({
      code: "reminder_expired",
      message: "Your reminder connection expired. Enable it again in Settings.",
      route: "data/sleep",
    });
  else if (
    input.reminder?.enabled &&
    (!input.remindersConfigured || input.reminder.last_status === "failed")
  )
    notices.push({
      code: "reminder_failed",
      message:
        "Your reminder could not be sent. Check its settings; your journal is still available.",
      route: "data/sleep",
    });
  if (input.budget === "exhausted")
    notices.push({
      code: "ai_exhausted",
      message:
        "Coach's AI allowance is used up. You can still log workouts, repeat meals and edit your journal directly.",
      route: "journal",
    });
  if (input.budget === "low")
    notices.push({
      code: "ai_low",
      message:
        "Coach's AI allowance is running low. Direct journal logging remains available.",
      route: "journal",
    });
  return notices;
}
