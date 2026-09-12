"use client";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { LiftingVideoDialog as FrameReview } from "./lifting-video";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { FileUp } from "./ui/icons";
import { AssistantText } from "./assistant-text";
import { GuidedReplay } from "./video-guided-replay";
import { privateFetch } from "@/lib/private-fetch";
import { today } from "@/lib/domain";
import {
  MAX_VIDEO_BYTES,
  videoUploadLifts,
  type VideoUpload,
  videoUploadSchema,
  type SavedVideoReview,
} from "@/lib/video/types";

function ReviewResult({
  review,
  accountId,
}: {
  review: SavedVideoReview;
  accountId: string;
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
      {url && (
        <>
          <GuidedReplay review={review} url={url} onTime={setTime} />
          <details className="video-review-tools">
            <summary>More detail & downloads</summary>
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
        <details open={!a?.coaching}>
          <summary>Full Coach review</summary>
          <section aria-label="Coach video feedback">
            <h3>Coach’s feedback</h3>
            <AssistantText text={review.feedback} />
          </section>
        </details>
      )}
    </div>
  );
}

export function LiftingVideoDialog(props: ComponentProps<typeof FrameReview>) {
  const [advanced, setAdvanced] = useState(false),
    [manual, setManual] = useState(false);
  const submitting = useRef(false);
  const [legacy, setLegacy] = useState(false),
    [tab, setTab] = useState<"upload" | "reviews">("upload");
  const [reviews, setReviews] = useState<SavedVideoReview[]>([]),
    [selected, setSelected] = useState<string | null>(null);
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
  const [x, setX] = useState(0.5),
    [y, setY] = useState(0.5),
    [diameter, setDiameter] = useState(0.15),
    [cm, setCm] = useState("");
  const [side, setSide] = useState(false),
    [realTime, setRealTime] = useState(false);
  const player = useRef<HTMLVideoElement>(null),
    upload = useRef<AbortController | null>(null),
    id = useRef(crypto.randomUUID());
  const auth = { "X-Journal-Account": props.accountId };
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    if (legacy) return;
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const r = await privateFetch("/api/lifting-videos", {
          headers: { "X-Journal-Account": props.accountId },
          signal: abort.signal,
        });
        if (!r.ok)
          throw Error(
            "Could not load saved video reviews. Reopen this window to retry.",
          );
        const data = await r.json();
        if (!abort.signal.aborted) setReviews(data.videos);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [props.accountId, legacy]);
  const summary = reviews.find((r) => r.id === selected);
  const [detail, setDetail] = useState<SavedVideoReview | null>(null);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    void (async () => {
      const response = await privateFetch(`/api/lifting-videos/${selected}`, {
        headers: { "X-Journal-Account": props.accountId },
        signal: abort.signal,
      });
      if (!response.ok)
        throw Error("Could not open this review. Reopen it to retry.");
      const data = await response.json();
      if (!abort.signal.aborted) setDetail(data);
    })().catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [
    selected,
    summary?.status,
    summary?.stage,
    summary?.hasMedia,
    props.accountId,
  ]);
  if (legacy) return <FrameReview {...props} />;
  const review = detail?.id === selected ? detail : summary;
  async function submit(chosenFile = file, automatic = !manual) {
    if (!chosenFile || submitting.current || busy) return;
    setError("");
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
                x,
                y,
                diameterPixelsRatio: diameter,
                diameterCm: Number(cm),
                sideView: side,
                realTime,
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
      const r = await privateFetch("/api/lifting-videos", {
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": "application/octet-stream",
          "X-Video-Metadata": encodeURIComponent(JSON.stringify(input)),
        },
        body: chosenFile,
        signal: upload.current.signal,
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(data.error ?? "Upload failed. Retry with the same clip.");
      setReviews((current) => [
        data,
        ...current.filter((v) => v.id !== data.id),
      ]);
      setSelected(data.id);
      setTab("reviews");
      setNotice(
        "Video saved. Analysis continues when you close this window or use another part of the app.",
      );
      setFile(null);
      setUrl("");
      setFrame("");
      id.current = crypto.randomUUID();
    } catch (e) {
      if (!upload.current.signal.aborted) setError((e as Error).message);
    } finally {
      submitting.current = false;
      if (!upload.current.signal.aborted) setBusy(false);
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
        if (!open) props.onClose();
      }}
    >
      <div className="lifting-video-flow video-upload-flow">
        <div className="video-review-tabs" aria-label="Video review views">
          <Button
            variant={tab === "upload" ? "default" : "ghost"}
            onClick={() => setTab("upload")}
          >
            Upload video
          </Button>
          <Button
            variant={tab === "reviews" ? "default" : "ghost"}
            onClick={() => setTab("reviews")}
          >
            Your reviews{reviews.length ? ` (${reviews.length})` : ""}
          </Button>
        </div>
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
                  id.current = crypto.randomUUID();
                  if (!advanced) void submit(f, true);
                }}
              />
            </label>
            <p className="fine-print">
              Private to you · MP4, MOV or WebM · Up to 2 minutes / 50 MB
            </p>
            {url && (
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
                    id.current = crypto.randomUUID();
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
                      id.current = crypto.randomUUID();
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
                      id.current = crypto.randomUUID();
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
                          id.current = crypto.randomUUID();
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
                          id.current = crypto.randomUUID();
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
                    id.current = crypto.randomUUID();
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
                      id.current = crypto.randomUUID();
                    }}
                  />
                  Add experimental bar tracking
                </label>
                {tracking && (
                  <fieldset disabled={busy} className="video-calibration">
                    <p>
                      At the start of your selection, mark the visible plate
                      centre. Adjust the circle to its outside edge and enter
                      its actual diameter.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={busy || !duration}
                      onClick={() => {
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
                            setError(
                              "Could not preview the start frame. Try another clip.",
                            );
                          }
                        };
                        v.pause();
                        if (Math.abs(v.currentTime - Number(start)) < 0.001)
                          capture();
                        else {
                          v.addEventListener("seeked", capture, { once: true });
                          v.currentTime = Number(start);
                          v.scrollIntoView({ block: "center" });
                        }
                      }}
                    >
                      Mark plate on start frame
                    </Button>
                    {frame && (
                      <button
                        className="video-seed"
                        type="button"
                        aria-label="Set plate centre on preview"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setX(
                            Math.max(
                              0.03,
                              Math.min(
                                0.97,
                                (e.clientX - rect.left) / rect.width,
                              ),
                            ),
                          );
                          setY(
                            Math.max(
                              0.03,
                              Math.min(
                                0.97,
                                (e.clientY - rect.top) / rect.height,
                              ),
                            ),
                          );
                          id.current = crypto.randomUUID();
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={frame}
                          alt="Start frame for marking the plate"
                        />
                        <svg
                          viewBox={`0 0 ${dimensions.w} ${dimensions.h}`}
                          aria-hidden="true"
                        >
                          <circle
                            cx={x * dimensions.w}
                            cy={y * dimensions.h}
                            r={(diameter * dimensions.w) / 2}
                            fill="none"
                            stroke="#ffde59"
                            strokeWidth="4"
                          />
                          <circle
                            cx={x * dimensions.w}
                            cy={y * dimensions.h}
                            r="5"
                            fill="#ffde59"
                          />
                        </svg>
                      </button>
                    )}
                    <div className="lifting-video-fields">
                      <label>
                        Centre from left (%)
                        <input
                          type="number"
                          min="3"
                          max="97"
                          value={Math.round(x * 100)}
                          onChange={(e) => {
                            setX(Number(e.target.value) / 100);
                            id.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <label>
                        Centre from top (%)
                        <input
                          type="number"
                          min="3"
                          max="97"
                          value={Math.round(y * 100)}
                          onChange={(e) => {
                            setY(Number(e.target.value) / 100);
                            id.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <label>
                        Circle size
                        <input
                          type="range"
                          min="0.02"
                          max="0.6"
                          step="0.005"
                          value={diameter}
                          onChange={(e) => {
                            setDiameter(Number(e.target.value));
                            id.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <label>
                        Actual plate diameter (cm)
                        <input
                          type="number"
                          min="5"
                          max="100"
                          value={cm}
                          placeholder="Measure or check the plate"
                          onChange={(e) => {
                            setCm(e.target.value);
                            id.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                    </div>
                    <label className="video-check">
                      <input
                        type="checkbox"
                        checked={side}
                        onChange={(e) => {
                          setSide(e.target.checked);
                          id.current = crypto.randomUUID();
                        }}
                      />
                      The camera is fixed and side-on, with the plate face
                      visible.
                    </label>
                    <label className="video-check">
                      <input
                        type="checkbox"
                        checked={realTime}
                        onChange={(e) => {
                          setRealTime(e.target.checked);
                          id.current = crypto.randomUUID();
                        }}
                      />
                      Playback is real-time, with no slow-motion or speed edits.
                    </label>
                    <p className="fine-print">
                      Unconfirmed timing keeps velocity unavailable. Even a
                      plausible track can be wrong; check the overlay before
                      using the estimates.
                    </p>
                  </fieldset>
                )}
              </details>
            </details>
            {file && (
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
                No saved video reviews yet. Upload your first lift to get
                started.
              </p>
            )}
            <div className="video-review-list">
              {reviews.map((r) => (
                <button
                  key={r.id}
                  className={r.id === selected ? "selected" : ""}
                  onClick={() => {
                    setSelected(r.id);
                    setNotice("");
                  }}
                >
                  <span>
                    <strong>
                      {r.analysis?.identification?.lift ??
                        (r.lift === "Identify from video"
                          ? "Lifting video"
                          : r.lift)}
                    </strong>
                    <small>
                      {r.date}
                      {r.load ? ` · ${r.load}` : ""}
                    </small>
                  </span>
                  <span>{r.stage} →</span>
                </button>
              ))}
            </div>
            {review && (
              <section className="video-review-detail">
                <h3>
                  {review.analysis?.identification?.lift ??
                    (review.lift === "Identify from video"
                      ? "Lifting video"
                      : review.lift)}
                  {review.load ? ` · ${review.load}` : ""}
                </h3>
                {(review.status === "queued" ||
                  review.status === "processing") && (
                  <p role="status">
                    {review.stage}… You can leave and come back here.
                  </p>
                )}
                {review.error && <p role="alert">{review.error}</p>}
                <ReviewResult
                  key={review.id}
                  review={review}
                  accountId={props.accountId}
                />
                <div className="button-row">
                  {review.status === "ready" &&
                    !review.analysis?.identification?.lift && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void action(review, "reanalyse", review.lift)
                        }
                      >
                        Analyse again
                      </Button>
                    )}
                  {review.status === "failed" && (
                    <Button
                      disabled={busy}
                      onClick={() => void action(review, "retry")}
                    >
                      Retry analysis
                    </Button>
                  )}
                  {(review.status === "ready" ||
                    review.status === "failed") && (
                    <CorrectReview
                      key={review.id + review.lift}
                      review={review}
                      busy={busy}
                      onSubmit={(value) =>
                        void action(review, "reanalyse", value)
                      }
                    />
                  )}
                  <details>
                    <summary>Remove review</summary>
                    <p>
                      Deletes this saved clip, analysis and feedback. A running
                      review will be cancelled.
                    </p>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void action(review, "delete")}
                    >
                      Delete video and review
                    </Button>
                  </details>
                </div>
              </section>
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
