import type { SavedVideoReview } from "./types";

export type VideoProgress = {
  queuedAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  phase: "queued" | "preparing" | "tracking" | "coaching" | "body" | "ready";
  bodyRequested?: boolean;
  attempt?: number;
  attemptCount?: number;
};

export function queuedVideoProgress(
  now = new Date().toISOString(),
): VideoProgress {
  return { queuedAt: now, updatedAt: now, phase: "queued" };
}

export function elapsedSeconds(since: string | undefined, now: number) {
  const value = since ? Date.parse(since) : NaN;
  return Number.isFinite(value) ? Math.max(0, (now - value) / 1000) : null;
}

export function clockDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// A range from this account's measured, comparable runs, never a fabricated
// percentage or countdown. Old reviews without timings are not observations.
export function processingEstimate(
  review: SavedVideoReview,
  history: SavedVideoReview[],
  now: number,
) {
  const p = review.progress;
  const elapsed = elapsedSeconds(p?.startedAt, now);
  const duration = review.analysis?.duration;
  if (!p?.startedAt || elapsed === null || !duration) return null;
  const samples = history
    .flatMap((r) => {
      const q = r.progress;
      const d = r.analysis?.duration;
      if (
        r.id === review.id ||
        r.status !== "ready" ||
        !q?.completedAt ||
        !q.startedAt ||
        q.bodyRequested !== p.bodyRequested ||
        r.settings?.mode !== review.settings?.mode ||
        !d ||
        d / duration < 0.5 ||
        d / duration > 2 ||
        (q.attemptCount ?? 1) !== (p.attemptCount ?? 1)
      )
        return [];
      const seconds =
        (Date.parse(q.completedAt) - Date.parse(q.startedAt)) / 1000;
      return seconds >= 5 && seconds <= 3600 ? [seconds] : [];
    })
    .slice(0, 10)
    .sort((a, b) => a - b);
  if (samples.length < 3) return null;
  // Allow headroom for model/GPU variance; stop counting down once exceeded.
  const low = samples[Math.floor((samples.length - 1) * 0.25)] * 0.8;
  const high = samples[Math.ceil((samples.length - 1) * 0.75)] * 1.3;
  return {
    low: Math.max(0, low - elapsed),
    high: Math.max(0, high - elapsed),
    overdue: elapsed >= high,
    samples: samples.length,
  };
}

export function remainingLabel(low: number, high: number) {
  if (high < 60) return "Less than a minute remaining";
  const lo = Math.max(1, Math.ceil(low / 60)),
    hi = Math.max(lo, Math.ceil(high / 60));
  return `About ${lo === hi ? hi : `${lo}–${hi}`} min remaining`;
}

// Compatibility for jobs already in flight when progress tracking was deployed.
export function reviewPhase(review: SavedVideoReview): VideoProgress["phase"] {
  if (review.progress) return review.progress.phase;
  if (review.status === "ready") return "ready";
  if (/3D body/.test(review.stage)) return "body";
  if (/outlines|^Reviewing/.test(review.stage)) return "tracking";
  if (/feedback|tracked movement/.test(review.stage)) return "coaching";
  return review.status === "queued" ? "queued" : "preparing";
}
