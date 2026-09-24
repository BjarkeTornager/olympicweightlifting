"use client";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { LiftingVideoDialog as FrameReview } from "./lifting-video";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { FileUp } from "./ui/icons";
import { VideoUploadProgress } from "./video-progress";
import { VideoReviewDetail, VideoReviewList } from "./video-review-detail";
import {
  PlateCalibrationFields,
  defaultPlateCalibration,
} from "./video-plate-calibration";
import { uploadLiftingVideo, type UploadProgress } from "@/lib/video/upload";
import { privateFetch } from "@/lib/private-fetch";
import { today } from "@/lib/domain";
import { useVideoReviewDetail, useVideoReviews } from "@/lib/use-video-reviews";
import {
  MAX_VIDEO_BYTES,
  videoUploadLifts,
  type VideoUpload,
  videoUploadSchema,
  type SavedVideoReview,
} from "@/lib/video/types";

export function LiftingVideoDialog(props: ComponentProps<typeof FrameReview>) {
  const [advanced, setAdvanced] = useState(false),
    [manual, setManual] = useState(false);
  const submitting = useRef(false);
  const [legacy, setLegacy] = useState(false),
    [tab, setTab] = useState<"upload" | "reviews">("upload");
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState("");
  const [lift, setLift] = useState<VideoUpload["lift"]>("Identify from video"),
    [load, setLoad] = useState(""),
    [date, setDate] = useState(today());
  const [start, setStart] = useState("0"),
    [end, setEnd] = useState("6"),
    [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tracking, setTracking] = useState(false),
    [frame, setFrame] = useState("");
  const [dimensions, setDimensions] = useState({ w: 640, h: 480 });
  const [calibration, setCalibration] = useState(defaultPlateCalibration);
  const player = useRef<HTMLVideoElement>(null),
    upload = useRef<AbortController | null>(null),
    id = useRef(crypto.randomUUID());
  const auth = { "X-Journal-Account": props.accountId };
  // Any change to the clip or its details is a new upload, so a retry never
  // reuses the server's result for different input.
  const newUploadId = () => {
    id.current = crypto.randomUUID();
  };
  const captureFrame = () => {
    const v = player.current;
    if (!v) return;
    setError("");
    const capture = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d")!.drawImage(v, 0, 0);
        setFrame(c.toDataURL("image/jpeg", 0.8));
      } catch {
        setError("Could not preview the start frame. Try another clip.");
      }
    };
    v.pause();
    if (Math.abs(v.currentTime - Number(start)) < 0.001) capture();
    else {
      v.addEventListener("seeked", capture, { once: true });
      v.currentTime = Number(start);
      v.scrollIntoView({ block: "center" });
    }
  };
  const uploading = Boolean(uploadProgress);
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const {
    reviews,
    setReviews,
    lastCheckedAt,
    connectionIssue,
    bodyOverlayEnabled,
    received,
  } = useVideoReviews(props.accountId, !legacy);
  const summary = reviews.find((r) => r.id === selected);
  const {
    detail,
    setDetail,
    issue: detailIssue,
  } = useVideoReviewDetail(props.accountId, selected, summary);
  if (legacy) return <FrameReview {...props} />;
  const review = detail?.id === selected ? detail : summary;
  async function submit(chosenFile = file, automatic = !manual) {
    if (!chosenFile || submitting.current || busy) return;
    setError("");
    setNotice("");
    let input;
    try {
      input = videoUploadSchema.parse({
        id: id.current,
        lift,
        load,
        date,
        mode: automatic ? "automatic" : "manual",
        start: automatic ? 0 : Number(start),
        end: automatic ? 120 : Number(end),
        ...(!automatic && tracking
          ? {
              calibration: {
                x: calibration.x,
                y: calibration.y,
                diameterPixelsRatio: calibration.diameter,
                diameterCm: Number(calibration.cm),
                sideView: calibration.side,
                realTime: calibration.realTime,
              },
            }
          : {}),
      });
      if (!automatic && tracking && !frame)
        throw Error("Preview the start frame and mark your plate first.");
    } catch {
      setError(
        "Choose a valid 0.5–20 second section. For measurements, mark the plate, enter its diameter and confirm the side view.",
      );
      return;
    }
    submitting.current = true;
    upload.current = new AbortController();
    setBusy(true);
    try {
      const data = await uploadLiftingVideo(
        chosenFile,
        input,
        props.accountId,
        upload.current.signal,
        setUploadProgress,
      );
      setReviews((current) => [
        data,
        ...current.filter((v) => v.id !== data.id),
      ]);
      setSelected(data.id);
      setDetail(data);
      received();
      setTab("reviews");
      setFile(null);
      setUrl("");
      setFrame("");
      newUploadId();
    } catch (e) {
      if (!upload.current.signal.aborted) setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
      setUploadProgress(null);
    }
  }
  async function action(
    target: SavedVideoReview,
    kind: "retry" | "delete" | "reanalyse",
    correctedLift?: string,
  ) {
    setError("");
    setBusy(true);
    try {
      const r = await privateFetch(
        `/api/lifting-videos/${target.id}${kind === "delete" ? "" : `/${kind}`}`,
        {
          method: kind === "delete" ? "DELETE" : "POST",
          headers: {
            ...auth,
            ...(correctedLift ? { "X-Video-Lift": correctedLift } : {}),
          },
        },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error ?? "Could not update this review.");
      setReviews((rows) =>
        kind === "delete"
          ? rows.filter((v) => v.id !== target.id)
          : rows.map((v) => (v.id === target.id ? data : v)),
      );
      if (kind === "delete") setSelected(null);
      else setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="Review a lifting video"
      className="guided-video-dialog"
      onOpenChange={(open) => {
        if (!open && uploadProgress)
          setNotice(
            "Your upload is still in progress. Keep this window open, or choose Cancel upload.",
          );
        else if (!open) props.onClose();
      }}
    >
      <div className="lifting-video-flow video-upload-flow">
        {tab === "reviews" && review ? (
          <Button variant="ghost" onClick={() => setSelected(null)}>
            ← All reviews
          </Button>
        ) : (
          <div className="video-review-tabs" aria-label="Video review views">
            <Button
              variant={tab === "upload" ? "default" : "ghost"}
              disabled={Boolean(uploadProgress)}
              onClick={() => setTab("upload")}
            >
              Upload video
            </Button>
            <Button
              variant={tab === "reviews" ? "default" : "ghost"}
              disabled={Boolean(uploadProgress)}
              onClick={() => setTab("reviews")}
            >
              Your reviews{reviews.length ? ` (${reviews.length})` : ""}
            </Button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {tab === "upload" ? (
          <>
            <p className="lead">Your lift. One clear next step.</p>
            <p className="muted">
              Upload your lift. Coach will find the movement and show you what
              to work on, with feedback on the replay.
            </p>
            {!uploadProgress &&
              reviews.some(
                (r) => r.status === "queued" || r.status === "processing",
              ) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTab("reviews");
                    setSelected(
                      reviews.find(
                        (r) =>
                          r.status === "queued" || r.status === "processing",
                      )!.id,
                    );
                  }}
                >
                  View analysis in progress →
                </Button>
              )}
            {uploadProgress && (
              <VideoUploadProgress
                progress={uploadProgress}
                onCancel={() => {
                  upload.current?.abort();
                  setNotice(
                    "Upload cancelled. You can retry with the same clip.",
                  );
                }}
              />
            )}
            <div hidden={Boolean(uploadProgress)}>
              <label className="video-upload-picker">
                <FileUp size={30} aria-hidden="true" />
                <span>{busy ? "Uploading your lift…" : "Upload lift"}</span>
                <input
                  className="sr-only"
                  aria-label="Upload lifting video"
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > MAX_VIDEO_BYTES) {
                      setError("Choose a video under 50 MB.");
                      return;
                    }
                    setFile(f);
                    setUrl(URL.createObjectURL(f));
                    setError("");
                    setFrame("");
                    setStart("0");
                    setDuration(0);
                    newUploadId();
                    if (!advanced) void submit(f, true);
                  }}
                />
              </label>
              <p className="fine-print">
                Private to you · MP4, MOV or WebM · Up to 2 minutes / 50 MB
              </p>
            </div>
            {url && !uploadProgress && (
              <video
                ref={player}
                src={url}
                controls
                playsInline
                muted
                preload="metadata"
                aria-label="Upload preview"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (!Number.isFinite(d) || d > 120 || d < 0.5) {
                    setError(
                      "Choose a clip between half a second and two minutes.",
                    );
                    setDuration(0);
                    return;
                  }
                  setDuration(d);
                  setEnd(String(Math.min(d, 20)));
                  setDimensions({
                    w: e.currentTarget.videoWidth,
                    h: e.currentTarget.videoHeight,
                  });
                }}
                onError={() =>
                  setError(
                    "Preview unavailable in this browser. You can still upload MP4, MOV or WebM for processing.",
                  )
                }
              />
            )}
            <details
              open={advanced}
              onToggle={(e) => setAdvanced(e.currentTarget.open)}
            >
              <summary>Add details or trim (optional)</summary>
              <label className="video-check">
                <input
                  type="checkbox"
                  checked={manual}
                  disabled={busy}
                  onChange={(e) => {
                    setManual(e.target.checked);
                    if (!e.target.checked) setTracking(false);
                    newUploadId();
                  }}
                />
                Choose a shorter section
              </label>
              <div className="lifting-video-fields">
                <label>
                  Lift
                  <select
                    value={lift}
                    disabled={busy}
                    onChange={(e) => {
                      setLift(e.target.value as VideoUpload["lift"]);
                      newUploadId();
                    }}
                  >
                    {videoUploadLifts.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Load, if known
                  <input
                    value={load}
                    disabled={busy}
                    placeholder="e.g. 60 kg"
                    maxLength={80}
                    onChange={(e) => {
                      setLoad(e.target.value);
                      newUploadId();
                    }}
                  />
                </label>
                {manual && (
                  <>
                    <label>
                      Start (seconds)
                      <input
                        type="number"
                        min="0"
                        max={duration || 120}
                        step="0.01"
                        value={start}
                        disabled={busy}
                        onChange={(e) => {
                          setStart(e.target.value);
                          setFrame("");
                          newUploadId();
                        }}
                      />
                    </label>
                    <label>
                      End (seconds)
                      <input
                        type="number"
                        min="0.5"
                        max={duration || 120}
                        step="0.01"
                        value={end}
                        disabled={busy}
                        onChange={(e) => {
                          setEnd(e.target.value);
                          newUploadId();
                        }}
                      />
                    </label>
                  </>
                )}
              </div>
              <label>
                Training date
                <input
                  type="date"
                  value={date}
                  disabled={busy}
                  onChange={(e) => {
                    setDate(e.target.value);
                    newUploadId();
                  }}
                />
              </label>
              <details>
                <summary>Filming tips & optional bar measurements</summary>
                <p>
                  Keep the whole lifter, feet and bar visible, with good light
                  and a steady camera. Choose up to 20 seconds, including the
                  setup and catch. For clean & jerk, include the front-rack
                  receipt, recovery and the later jerk overhead. For bar
                  measurements, use a fixed side-on view.
                </p>
                <label className="video-check">
                  <input
                    type="checkbox"
                    checked={tracking}
                    disabled={busy}
                    onChange={(e) => {
                      setTracking(e.target.checked);
                      if (e.target.checked) setManual(true);
                      newUploadId();
                    }}
                  />
                  Add experimental bar tracking
                </label>
                {tracking && (
                  <PlateCalibrationFields
                    busy={busy}
                    duration={duration}
                    frame={frame}
                    dimensions={dimensions}
                    calibration={calibration}
                    onCaptureFrame={captureFrame}
                    onChange={(patch) => {
                      setCalibration((current) => ({ ...current, ...patch }));
                      newUploadId();
                    }}
                  />
                )}
              </details>
            </details>
            {file && !uploadProgress && (
              <Button disabled={busy} onClick={() => void submit()}>
                {busy ? "Uploading video…" : "Upload & analyse lift"}
              </Button>
            )}
            <p className="fine-print">
              Keep this window open until upload finishes. Processing then
              continues in the background. The video is saved privately without
              audio or location metadata; the source upload is removed after
              processing. Sampled frames go to your configured Coach provider.
              This does not log a workout.
            </p>
            <details>
              <summary>Other review options</summary>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setLegacy(true)}
              >
                Use on-device frame review
              </Button>
            </details>
          </>
        ) : (
          <>
            {!reviews.length && (
              <p>
                {connectionIssue
                  ? "Could not load your reviews. Check your connection; we’ll keep trying."
                  : !lastCheckedAt
                    ? "Loading your reviews…"
                    : "No saved video reviews yet. Upload your first lift to get started."}
              </p>
            )}
            {!review && (
              <VideoReviewList
                reviews={reviews}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setNotice("");
                }}
              />
            )}
            {review && (
              <VideoReviewDetail
                review={review}
                reviews={reviews}
                accountId={props.accountId}
                busy={busy}
                bodyOverlayEnabled={bodyOverlayEnabled}
                lastCheckedAt={lastCheckedAt}
                connectionIssue={connectionIssue || detailIssue}
                onLeave={props.onClose}
                onAction={(kind, lift) => void action(review, kind, lift)}
              />
            )}
            <p className="fine-print">
              Private to your account. Up to 20 clips or 500 MB. Feedback and
              bar tracking are experimental and may miss or misinterpret
              movement.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
