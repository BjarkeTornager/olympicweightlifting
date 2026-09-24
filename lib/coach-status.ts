import type { SyncStatus } from "./use-journal";

// Why Coach can't take a message right now, most urgent first; "" when ready.
export function coachConnectionHint(s: {
  conflict: boolean;
  // Unsynced or conflicting journal changes.
  pending: boolean;
  journalStatus: SyncStatus;
  connectionError: string;
  connecting: boolean;
  enabled: boolean;
  loadingImage: boolean;
}) {
  if (s.conflict)
    return "Choose which journal version to keep before messaging Coach.";
  if (s.pending)
    return "Sync your pending changes before messaging Coach. Your draft is still here.";
  if (s.journalStatus === "offline")
    return "You’re offline. Reconnect to send your message. Your draft is still here.";
  if (s.journalStatus !== "synced")
    return "Your journal hasn’t connected yet. Reconnect to send your message.";
  if (s.connectionError) return s.connectionError;
  if (s.connecting) return "Connecting to Coach… Your draft is still here.";
  if (!s.enabled)
    return "Coach is temporarily unavailable. Try reconnecting in a moment.";
  if (s.loadingImage) return "Loading your attached image…";
  return "";
}

// The one-line status shown elsewhere in the app while Coach works in the
// background, or null when there is nothing to report.
export function coachBackgroundStatus(s: {
  failed: boolean;
  busy: boolean;
  queued: number;
  acting: boolean;
  preparingPhoto: boolean;
  result: "ready" | "failed" | null;
}) {
  if (s.failed) return "Coach needs your attention";
  if (s.busy)
    return s.queued
      ? `Coach is working… ${s.queued} queued`
      : "Coach is working…";
  if (s.queued) return `${s.queued} messages waiting for Coach`;
  if (s.acting) return "Coach is saving your change…";
  if (s.preparingPhoto) return "Coach is preparing your photo…";
  if (s.result === "ready") return "Your Coach reply is ready";
  if (s.result === "failed") return "Coach needs your attention";
  return null;
}
