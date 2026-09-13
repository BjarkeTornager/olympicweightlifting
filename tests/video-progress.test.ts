import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockDuration,
  processingEstimate,
  queuedVideoProgress,
  remainingLabel,
  reviewPhase,
} from "../lib/video/progress";
import type { SavedVideoReview } from "../lib/video/types";

const epoch = Date.parse("2026-09-13T10:00:00Z");
const at = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
const review = (id: string, time?: number): SavedVideoReview => ({
  id,
  status: time ? "ready" : "processing",
  lift: "Clean & jerk",
  date: "2026-09-13",
  load: "",
  stage: "Preparing your 3D body overlay",
  createdAt: at(0),
  error: null,
  feedback: null,
  hasMedia: true,
  analysis: { duration: 15 } as SavedVideoReview["analysis"],
  progress: {
    queuedAt: at(0),
    startedAt: at(10),
    updatedAt: at(10),
    phase: time ? "ready" : "body",
    bodyRequested: true,
    attemptCount: 1,
    ...(time ? { completedAt: at(10 + time) } : {}),
  },
});
test("estimates use completed comparable runs, exclude self, failures, other modes and missing timings", () => {
  const active = review("active");
  const history = [review("a", 180), review("b", 200), review("c", 220)];
  assert.equal(
    processingEstimate(active, history.slice(0, 2), epoch + 60_000),
    null,
  );
  assert.equal(
    processingEstimate(
      active,
      [history[0], history[1], { ...history[2], progress: null }],
      epoch,
    ),
    null,
  );
  const estimate = processingEstimate(active, history, epoch + 60_000)!;
  assert.equal(estimate.samples, 3);
  assert.equal(estimate.low, 94);
  assert.equal(estimate.high, 236);
  assert.equal(estimate.overdue, false);
  for (const incompatible of [
    { ...history[2], id: active.id },
    { ...history[2], status: "failed" as const },
    {
      ...history[2],
      progress: { ...history[2].progress!, bodyRequested: false },
    },
    { ...history[2], progress: { ...history[2].progress!, attemptCount: 2 } },
    {
      ...history[2],
      analysis: { duration: 120 } as SavedVideoReview["analysis"],
    },
  ])
    assert.equal(
      processingEstimate(active, [...history.slice(0, 2), incompatible], epoch),
      null,
    );
});
test("queue has no countdown, overruns never display a false completion, retry resets elapsed", () => {
  const active = review("active"),
    history = [review("a", 180), review("b", 200), review("c", 220)];
  const retry = {
    ...active,
    status: "queued" as const,
    progress: queuedVideoProgress(at(600)),
  };
  assert.equal(processingEstimate(retry, history, epoch + 610_000), null);
  assert.equal(reviewPhase(retry), "queued");
  const overdue = processingEstimate(active, history, epoch + 1000_000)!;
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.high, 0);
  assert.equal(clockDuration(62.5), "1:02");
  assert.equal(remainingLabel(94, 236), "About 2–4 min remaining");
  assert.equal(remainingLabel(0, 15), "Less than a minute remaining");
});
test("a queued GPU receipt still displays the active overlay stage", () => {
  const resumed = { ...review("active"), status: "queued" as const };
  assert.equal(reviewPhase(resumed), "body");
  assert.equal(reviewPhase({ ...resumed, progress: null }), "body");
});
