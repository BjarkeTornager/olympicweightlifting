"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { AssistantText } from "./assistant-text";
import { GuidedReplay } from "./video-guided-replay";
import { VideoProcessingProgress } from "./video-progress";
import { privateFetch } from "@/lib/private-fetch";
import { currentVideoReview } from "@/lib/video/coaching";
import { videoUploadLifts, type SavedVideoReview } from "@/lib/video/types";

function ReviewResult({
  review,
  accountId,
  onReanalyse,
  busy,
  bodyOverlayEnabled,
}: {
  review: SavedVideoReview;
  accountId: string;
  onReanalyse: () => void;
  busy: boolean;
  bodyOverlayEnabled: boolean;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [time, setTime] = useState(0);
  useEffect(() => {
    if (!review.hasMedia) return;
    const abort = new AbortController();
    let blobUrl = "";
    void (async () => {
      const response = await privateFetch(
        `/api/lifting-videos/${review.id}/media`,
        { headers: { "X-Journal-Account": accountId }, signal: abort.signal },
      );
      if (!response.ok)
        throw Error("Could not load playback. Reopen this review to retry.");
      const blob = await response.blob();
      abort.signal.throwIfAborted();
      blobUrl = URL.createObjectURL(blob);
      setUrl(blobUrl);
    })().catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => {
      abort.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [accountId, review.id, review.hasMedia]);
  const a = review.analysis,
    t = a?.tracking;
  const outdated = review.status === "ready" && !currentVideoReview(a);
  const coachingUpdate =
    review.status === "ready" && a?.coaching?.version !== 2;
  const bodyUpdate =
    review.status === "ready" && bodyOverlayEnabled && !a?.body;
  const overlayUpdate = review.status === "ready" && a?.overlayVersion !== 1;
  const velocities = t?.velocities ?? [],
    min = Math.min(0, ...velocities.map((v) => v.value)),
    max = Math.max(0.1, ...velocities.map((v) => v.value));
  const plot = velocities
    .map(
      (v) =>
        `${36 + (v.t / Math.max(a?.duration ?? 1, 0.001)) * 528},${170 - ((v.value - min) / (max - min)) * 140}`,
    )
    .join(" ");
  return (
    <div className="video-review-result">
      {error && <p role="alert">{error}</p>}
      {(outdated || coachingUpdate || overlayUpdate) && (
        <section
          className="video-review-update"
          aria-label="Review update available"
        >
          <strong>
            {overlayUpdate
              ? "Complete your video overlays"
              : bodyUpdate
                ? a?.body
                  ? "Suggested movement is available"
                  : "3D body review is available"
                : "Updated coaching is available"}
          </strong>
          <p>
            {overlayUpdate ? (
              "Update your saved clip to run automatic bar and foreground body tracking. Available layers appear together in the player; corrected form still needs clear supporting evidence."
            ) : (
              <>
                Update this saved review for a coaching priority, a practice
                task and a suggested posture guide when the visible evidence
                supports it.
                {bodyUpdate &&
                  " This adds a suggested movement comparison when Coach can establish a supported posture adjustment. Your original clip is reused."}
              </>
            )}
          </p>
          <Button disabled={busy} onClick={onReanalyse}>
            Update analysis
          </Button>
        </section>
      )}
      {url && (
        <>
          <GuidedReplay review={review} url={url} onTime={setTime} />
          <details className="video-review-tools">
            <summary>Review details & downloads</summary>
            {bodyUpdate && !overlayUpdate && (
              <div className="video-review-update">
                <strong>3D body review is available</strong>
                <p>
                  Update this review to add reconstructed body detail to the
                  form guide. Your saved clip is reused.
                </p>
                <Button disabled={busy} onClick={onReanalyse}>
                  Update analysis
                </Button>
              </div>
            )}
            {a && (
              <p className="fine-print">
                Coach reviewed {a.sampleTimes.length} sampled frames. Fast
                movement may fall between them; highlights are experimental.
              </p>
            )}
            <div className="button-row">
              <a
                className="text-link"
                href={url}
                download={`lift-${review.date}.mp4`}
              >
                Download clip
              </a>
              <Button
                variant="ghost"
                onClick={() => {
                  const blob = URL.createObjectURL(
                    new Blob([JSON.stringify(review, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = blob;
                  link.download = `lift-review-${review.date}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(blob), 1000);
                }}
              >
                Export analysis
              </Button>
            </div>
          </details>
        </>
      )}
      {t && t.status !== "not_requested" && (
        <details>
          <summary>Optional bar measurements</summary>
          <section aria-label="Bar measurements">
            <p className="eyebrow">EXPERIMENTAL BAR TRACKING</p>
            <p className="fine-print">{t.reason}</p>
            <dl className="video-metrics">
              <div>
                <dt>Horizontal range</dt>
                <dd>
                  {t.horizontalRangeCm === null
                    ? "Unavailable"
                    : `${t.horizontalRangeCm} cm`}
                </dd>
              </div>
              <div>
                <dt>Rise from start</dt>
                <dd>{t.riseCm === null ? "Unavailable" : `${t.riseCm} cm`}</dd>
              </div>
              <div>
                <dt>Peak upward velocity*</dt>
                <dd>
                  {t.peakUpwardVelocity === null
                    ? "Unavailable"
                    : `${t.peakUpwardVelocity} m/s`}
                </dd>
              </div>
            </dl>
            {velocities.length > 0 && (
              <figure className="video-velocity-chart">
                <svg
                  viewBox="0 0 600 205"
                  role="img"
                  aria-label="Vertical velocity in metres per second over playback time"
                >
                  <line
                    x1="36"
                    x2="564"
                    y1="170"
                    y2="170"
                    stroke="currentColor"
                  />
                  <polyline
                    points={plot}
                    fill="none"
                    stroke="var(--brand, #b83b61)"
                    strokeWidth="3"
                  />
                  <text x="36" y="20">
                    {max.toFixed(1)} m/s
                  </text>
                  <text x="36" y="193">
                    0 s
                  </text>
                  <text x="510" y="193">
                    {a?.duration.toFixed(1)} s
                  </text>
                  <line
                    x1={
                      36 +
                      (Math.min(time, a?.duration ?? 1) /
                        Math.max(a?.duration ?? 1, 0.001)) *
                        528
                    }
                    x2={
                      36 +
                      (Math.min(time, a?.duration ?? 1) /
                        Math.max(a?.duration ?? 1, 0.001)) *
                        528
                    }
                    y1="30"
                    y2="170"
                    stroke="#777"
                    strokeDasharray="4"
                  />
                </svg>
                <figcaption>
                  *Smoothed over approximately 100 ms. Estimates depend on your
                  scale, timing and a correct track; this is not an
                  instantaneous peak.
                </figcaption>
              </figure>
            )}
          </section>
        </details>
      )}
      {review.feedback && (
        <details open={!outdated && !a?.coaching}>
          <summary>
            {outdated ? "Previous analysis" : "Full Coach review"}
          </summary>
          <section aria-label="Coach video feedback">
            <h3>Coach’s feedback</h3>
            <AssistantText text={review.feedback} />
          </section>
        </details>
      )}
    </div>
  );
}

export const videoReviewTitle = (r: SavedVideoReview) =>
  r.analysis?.identification?.lift ??
  (r.lift === "Identify from video" ? "Lifting video" : r.lift);
const inProgress = (r: SavedVideoReview) =>
  r.status === "queued" || r.status === "processing";

export function VideoReviewList({
  reviews,
  selected,
  onSelect,
}: {
  reviews: SavedVideoReview[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="video-review-list">
      {reviews.map((r) => (
        <button
          key={r.id}
          className={r.id === selected ? "selected" : ""}
          onClick={() => onSelect(r.id)}
        >
          <span>
            <strong>{videoReviewTitle(r)}</strong>
            <small>
              {r.date}
              {r.load ? ` · ${r.load}` : ""}
            </small>
          </span>
          <span className="video-review-state" data-active={inProgress(r)}>
            {inProgress(r) && (
              <span className="video-review-pulse" aria-hidden="true" />
            )}
            {r.stage} →
          </span>
        </button>
      ))}
    </div>
  );
}

export function VideoReviewDetail({
  review,
  reviews,
  accountId,
  busy,
  bodyOverlayEnabled,
  lastCheckedAt,
  connectionIssue,
  onLeave,
  onAction,
}: {
  review: SavedVideoReview;
  reviews: SavedVideoReview[];
  accountId: string;
  busy: boolean;
  bodyOverlayEnabled: boolean;
  lastCheckedAt: number | null;
  connectionIssue: boolean;
  onLeave: () => void;
  onAction: (
    kind: "retry" | "delete" | "reanalyse",
    correctedLift?: string,
  ) => void;
}) {
  return (
    <section className="video-review-detail">
      <h3>
        {videoReviewTitle(review)}
        {review.load ? ` · ${review.load}` : ""}
      </h3>
      <VideoProcessingProgress
        review={review}
        history={reviews}
        lastCheckedAt={lastCheckedAt}
        connectionIssue={connectionIssue}
        onLeave={onLeave}
      />
      {review.error && <p role="alert">{review.error}</p>}
      <ReviewResult
        key={review.id}
        review={review}
        accountId={accountId}
        busy={busy}
        bodyOverlayEnabled={bodyOverlayEnabled}
        onReanalyse={() =>
          onAction(
            "reanalyse",
            currentVideoReview(review.analysis)
              ? review.lift
              : "Identify from video",
          )
        }
      />
      <div className="button-row">
        {review.status === "ready" && currentVideoReview(review.analysis) && (
          <Button
            disabled={busy}
            onClick={() => onAction("reanalyse", review.lift)}
          >
            Analyse again
          </Button>
        )}
        {review.status === "failed" && (
          <Button disabled={busy} onClick={() => onAction("retry")}>
            Retry analysis
          </Button>
        )}
        {(review.status === "ready" || review.status === "failed") && (
          <CorrectReview
            key={review.id + review.lift}
            review={review}
            busy={busy}
            onSubmit={(value) => onAction("reanalyse", value)}
          />
        )}
        <details>
          <summary>Remove review</summary>
          <p>
            Deletes this saved clip, analysis and feedback. A running review
            will be cancelled.
          </p>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => onAction("delete")}
          >
            Delete video and review
          </Button>
        </details>
      </div>
    </section>
  );
}

function CorrectReview({
  review,
  busy,
  onSubmit,
}: {
  review: SavedVideoReview;
  busy: boolean;
  onSubmit: (lift: string) => void;
}) {
  const [value, setValue] = useState(review.lift);
  return (
    <details>
      <summary>Correct lift & reanalyse</summary>
      <p>
        Choose the movement you performed, or let Coach identify it. This
        replaces the feedback using your saved clip; no new upload is needed.
        Coach will still flag missing or conflicting visual evidence.
      </p>
      <label>
        Lift for this review
        <select
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        >
          {videoUploadLifts.map((lift) => (
            <option key={lift}>{lift}</option>
          ))}
        </select>
      </label>
      <Button disabled={busy} onClick={() => onSubmit(value)}>
        Reanalyse saved video
      </Button>
    </details>
  );
}
