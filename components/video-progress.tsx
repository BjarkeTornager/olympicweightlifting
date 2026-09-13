"use client";
import { useEffect, useState } from "react";
import { Check, Cloud, FileUp, LoaderCircle, Timer } from "./ui/icons";
import { Button } from "./ui/button";
import type { SavedVideoReview } from "@/lib/video/types";
import type { UploadProgress } from "@/lib/video/upload";
import {
  clockDuration,
  elapsedSeconds,
  processingEstimate,
  remainingLabel,
  reviewPhase,
} from "@/lib/video/progress";

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function bytesLabel(bytes: number) {
  return bytes < 1048576
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}

export function VideoUploadProgress({
  progress,
  onCancel,
}: {
  progress: UploadProgress;
  onCancel: () => void;
}) {
  const now = useClock();
  const elapsed = Math.max(0, (now - progress.startedAt) / 1000);
  const measured = Math.max(
    0,
    (progress.lastProgressAt - progress.startedAt) / 1000,
  );
  const stalled = now - progress.lastProgressAt > 20_000;
  const remaining =
    measured >= 2 && progress.loaded > 0 && !stalled
      ? (progress.total - progress.loaded) / (progress.loaded / measured)
      : null;
  const percent = Math.floor(
    (progress.loaded / Math.max(1, progress.total)) * 100,
  );
  return (
    <section className="video-progress-card" aria-label="Video upload progress">
      <div className="video-progress-heading">
        <span className="video-progress-icon">
          <FileUp size={26} aria-hidden="true" />
        </span>
        <div>
          <p className="video-progress-eyebrow">Step 1 · Upload</p>
          <h3 role="status">
            {progress.transferred
              ? "Saving your video…"
              : "Uploading your lift…"}
          </h3>
        </div>
        <strong className="video-progress-percent">{percent}%</strong>
      </div>
      <progress
        aria-label="Video bytes uploaded"
        value={progress.loaded}
        max={Math.max(1, progress.total)}
      />
      <div className="video-progress-meta">
        <span>
          {bytesLabel(progress.loaded)} / {bytesLabel(progress.total)}
        </span>
        <span>{clockDuration(elapsed)} elapsed</span>
      </div>
      <p>
        {progress.transferred
          ? "Transfer complete. Waiting for the server to confirm your video is saved."
          : stalled
            ? "The upload is taking a moment. Keep this window open and check your connection."
            : remaining !== null
              ? `${remainingLabel(remaining, remaining)} · Based on your upload speed.`
              : "Measuring your upload speed…"}
      </p>
      <div className="video-progress-footer">
        <span>Keep this window open until your video is saved.</span>
        <Button variant="ghost" onClick={onCancel}>
          Cancel upload
        </Button>
      </div>
    </section>
  );
}

const steps = [
  {
    id: "preparing",
    label: "Prepare video",
    detail: "Finding your lifts and their movement phases.",
  },
  {
    id: "tracking",
    label: "Track movement",
    detail: "Following your body and the bar to build the overlays.",
  },
  {
    id: "coaching",
    label: "Coach feedback",
    detail: "Reviewing the visible technique and choosing what to work on.",
  },
  {
    id: "body",
    label: "Build form guide",
    detail:
      "Preparing your body overlay and suggested movement. This step can take longer.",
  },
] as const;

export function VideoProcessingProgress({
  review,
  history,
  lastCheckedAt,
  connectionIssue,
  onLeave,
}: {
  review: SavedVideoReview;
  history: SavedVideoReview[];
  lastCheckedAt: number | null;
  connectionIssue: boolean;
  onLeave: () => void;
}) {
  const now = useClock();
  const phase = reviewPhase(review);
  const ready = review.status === "ready",
    failed = review.status === "failed";
  const waiting = phase === "queued";
  const stale =
    connectionIssue || !lastCheckedAt || now - lastCheckedAt > 20_000;
  const visible = steps.filter(
    (s) =>
      s.id !== "body" || review.progress?.bodyRequested || phase === "body",
  );
  const active = visible.findIndex((s) => s.id === phase);
  const elapsed = elapsedSeconds(review.progress?.queuedAt, now);
  const estimate =
    !stale && !waiting && !ready && !failed
      ? processingEstimate(review, history, now)
      : null;
  const description = waiting
    ? "Your video is saved and waiting for processing to start."
    : (visible[active]?.detail ?? "Preparing your analysis.");
  if (ready)
    return (
      <div className="video-progress-complete" role="status">
        <Check size={20} aria-hidden="true" />
        Your review is ready. Watch your lift below.
      </div>
    );
  if (failed)
    return (
      <section
        className="video-progress-card"
        aria-label="Video processing stopped"
      >
        <h3>Analysis needs a retry</h3>
        <p>
          Your video is saved. Use Retry analysis below to continue without
          uploading it again.
        </p>
      </section>
    );
  return (
    <section
      className="video-progress-card"
      aria-label="Video processing progress"
    >
      <div className="video-progress-heading">
        <span className="video-progress-icon">
          <LoaderCircle
            className="video-progress-spinner"
            size={26}
            aria-hidden="true"
          />
        </span>
        <div>
          <p className="video-progress-eyebrow">
            {waiting ? "In the queue" : "Step 2 · Analysis"}
            {(review.progress?.attemptCount ?? 0) > 1 &&
              ` · Lift ${review.progress!.attempt} of ${review.progress!.attemptCount}`}
          </p>
          <h3>
            {waiting
              ? "Waiting to start"
              : (visible[active]?.label ?? "Analysing your lift")}
          </h3>
        </div>
      </div>
      <p role="status" className="video-progress-stage">
        {review.stage}
      </p>
      <p>{description}</p>
      <ol className="video-progress-steps" aria-label="Analysis steps">
        {visible.map((s, i) => (
          <li
            key={s.id}
            aria-current={phase === s.id ? "step" : undefined}
            data-state={
              i < active ? "complete" : i === active ? "active" : "pending"
            }
          >
            <span aria-hidden="true">
              {i < active ? <Check size={15} /> : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="video-progress-timing">
        <Timer size={20} aria-hidden="true" />
        <div>
          <strong>
            {stale
              ? "Reconnecting to progress…"
              : waiting
                ? "Analysis will start automatically"
                : estimate?.overdue
                  ? "Taking longer than recent reviews"
                  : estimate
                    ? remainingLabel(estimate.low, estimate.high)
                    : "Timing estimate not available yet"}
          </strong>
          <small>
            {stale
              ? "Your saved analysis can continue. We’ll update this screen when the connection returns."
              : waiting
                ? "Processing starts automatically. Queue time varies."
                : estimate
                  ? `Estimated from ${estimate.samples} comparable reviews in your account. Queue and setup times can vary.`
                  : "Allow several minutes, especially for overlays. Estimates appear after three comparable reviews have completed."}
          </small>
        </div>
      </div>
      <div className="video-progress-meta">
        <span>
          {elapsed !== null
            ? `${clockDuration(elapsed)} since saved`
            : "Saved in your private library"}
        </span>
        <span>{stale ? "Updates delayed" : "Checking every 5 seconds"}</span>
      </div>
      <div className="video-progress-footer">
        <span>
          <Cloud size={18} aria-hidden="true" /> Video saved. You can leave;
          analysis continues. Find it in Your reviews.
        </span>
        <Button variant="ghost" onClick={onLeave}>
          Continue using the app
        </Button>
      </div>
    </section>
  );
}
