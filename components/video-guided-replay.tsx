"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Expand, X, RotateCcw, Sparkles } from "./ui/icons";
import { Button } from "./ui/button";
import type { SavedVideoReview } from "@/lib/video/types";
import { segmentationAt, trackedReplayAction } from "@/lib/video/segmentation";
import {
  barTrailSegments,
  currentVideoReview,
  evidenceFocusPoints,
  type CoachingMoment,
} from "@/lib/video/coaching";

const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export function GuidedReplay({
  review,
  url,
  onTime,
}: {
  review: SavedVideoReview;
  url: string;
  onTime: (time: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null);
  const trackedCanvas = useRef<HTMLCanvasElement>(null);
  const capturedTime = useRef<number | null>(null);
  const stopAt = useRef<{ end: number; freeze: number } | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const [renderTime, setRenderTime] = useState(0);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [seeking, setSeeking] = useState(false),
    [speed, setSpeed] = useState("1");
  const [overlay, setOverlay] = useState(true),
    [outlines, setOutlines] = useState(true),
    [barTrail, setBarTrail] = useState(false),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [duration, setDuration] = useState(review.analysis?.duration ?? 0);
  const a = review.analysis,
    coaching = currentVideoReview(a) ? a?.coaching : undefined,
    moments = coaching?.moments ?? [];
  const active = overlay
    ? (moments.find(
        (m) => m.id === selected && time >= m.start && time <= m.end,
      ) ?? moments.find((m) => time >= m.start && time <= m.end))
    : undefined;
  const points =
    a && active && !playing && !seeking
      ? evidenceFocusPoints(a, active, time)
      : [];
  const trails =
    a && barTrail && !seeking
      ? barTrailSegments(a, playing ? renderTime : time)
      : [];
  const regions =
    outlines && !playing && !seeking
      ? segmentationAt(a?.segmentation, time)
      : [];

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0,
      fallback = 0,
      closed = false;
    const hideTracked = () => {
      if (trackedCanvas.current) trackedCanvas.current.hidden = true;
      capturedTime.current = null;
    };
    const sync = (presentedTime: number, exactFrame = false) => {
      if (closed || v.seeking) return;
      if (pendingSeek.current !== null) {
        if (
          v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          Math.abs(v.currentTime - pendingSeek.current) > 0.025
        )
          return;
        pendingSeek.current = null;
      }
      setSeeking(false);
      // Safari can deliver an older queued presentation callback after a seek
      // or resize. It must not replace the paused inspection position.
      const t = v.paused ? v.currentTime : presentedTime;
      const canvas = trackedCanvas.current,
        segmentation = a?.segmentation;
      if (
        !v.paused &&
        exactFrame &&
        outlines &&
        canvas &&
        segmentation &&
        v.videoWidth === segmentation.width &&
        v.videoHeight === segmentation.height
      ) {
        const action = trackedReplayAction(
          segmentation,
          t,
          capturedTime.current,
        );
        if (action.kind === "clear") hideTracked();
        else if (action.kind === "capture") {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            // Capture pixels and polygons from the SAME presented source frame.
            // Between samples we retain this complete annotated frame, not a
            // stale polygon over the independently moving original video.
            canvas.width = segmentation.width;
            canvas.height = segmentation.height;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            ctx.lineWidth = (2.5 * canvas.width) / Math.max(1, v.clientWidth);
            for (const region of action.frame.objects) {
              ctx.beginPath();
              region.polygon.forEach(([x, y], i) => {
                if (i) ctx.lineTo(x * canvas.width, y * canvas.height);
                else ctx.moveTo(x * canvas.width, y * canvas.height);
              });
              ctx.closePath();
              ctx.strokeStyle = region.kind === "plate" ? "#83d5ea" : "#ffde59";
              ctx.fillStyle =
                region.kind === "plate" ? "#83d5ea20" : "#ffde5910";
              ctx.fill();
              ctx.stroke();
            }
            canvas.dataset.frameTime = String(action.frame.t);
            canvas.hidden = false;
            capturedTime.current = action.frame.t;
          } else hideTracked();
        }
      } else hideTracked();
      setRenderTime(capturedTime.current ?? t);
      setTime(t);
      onTime(t);
      if (stopAt.current !== null && t >= stopAt.current.end - 0.035) {
        const freeze = stopAt.current.freeze;
        v.pause();
        stopAt.current = null;
        pendingSeek.current = freeze;
        setSeeking(true);
        v.currentTime = freeze;
        setTime(freeze);
        onTime(freeze);
      }
    };
    const seek = () => sync(v.currentTime);
    const ready = () => {
      const target = pendingSeek.current;
      if (
        target !== null &&
        v.readyState >= HTMLMediaElement.HAVE_METADATA &&
        Math.abs(v.currentTime - target) > 0.001
      )
        v.currentTime = target;
      sync(v.currentTime);
    };
    v.addEventListener("seeked", seek);
    v.addEventListener("loadedmetadata", ready);
    v.addEventListener("loadeddata", ready);
    v.addEventListener("canplay", ready);
    if (typeof v.requestVideoFrameCallback === "function") {
      const frame: VideoFrameRequestCallback = (_now, metadata) => {
        sync(metadata.mediaTime, true);
        if (!closed) handle = v.requestVideoFrameCallback(frame);
      };
      handle = v.requestVideoFrameCallback(frame);
    } else {
      const tick = () => {
        if (!v.paused) sync(v.currentTime);
        fallback = requestAnimationFrame(tick);
      };
      fallback = requestAnimationFrame(tick);
    }
    return () => {
      closed = true;
      hideTracked();
      v.removeEventListener("seeked", seek);
      v.removeEventListener("loadedmetadata", ready);
      v.removeEventListener("loadeddata", ready);
      v.removeEventListener("canplay", ready);
      if (handle) v.cancelVideoFrameCallback(handle);
      if (fallback) cancelAnimationFrame(fallback);
    };
  }, [url, onTime, outlines, a?.segmentation]);

  useEffect(() => {
    if (!expanded) return;
    const inactive: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement | null = container.current;
    const dialog = branch?.closest('[role="dialog"]');
    while (branch?.parentElement && branch !== dialog) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          inactive.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      for (const { element, inert } of inactive) element.inert = inert;
    };
  }, [expanded]);

  function play() {
    setError("");
    void video.current
      ?.play()
      .catch(() => setError("Tap play to start the replay."));
  }
  function seekTo(at: number) {
    const v = video.current;
    if (!v) return;
    pendingSeek.current = at;
    setSeeking(true);
    // A click may arrive before Safari has decoded the blob's metadata.
    // Retain the requested frame until a media readiness event can apply it.
    if (
      !v.seeking &&
      v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      Math.abs(v.currentTime - at) < 0.001
    ) {
      pendingSeek.current = null;
      setSeeking(false);
    } else if (v.readyState >= HTMLMediaElement.HAVE_METADATA)
      v.currentTime = at;
    setTime(at);
    onTime(at);
  }
  function replay(moment: CoachingMoment) {
    const v = video.current;
    if (!v) return;
    v.scrollIntoView({ block: "center", behavior: "instant" });
    setSelected(moment.id);
    setOverlay(true);
    setSpeed("0.5");
    v.playbackRate = 0.5;
    seekTo(moment.start);
    stopAt.current = { end: moment.end, freeze: moment.evidenceTime };
    play();
  }
  function inspect(moment: CoachingMoment, at = moment.evidenceTime) {
    const v = video.current;
    if (!v) return;
    // Scrolling the entire review can leave the video offscreen when the cue
    // cards make it taller than the viewport. WebKit can suspend decoding of
    // that offscreen media, and the user cannot see the requested evidence.
    v.scrollIntoView({ block: "center", behavior: "instant" });
    stopAt.current = null;
    v.pause();
    setPlaying(false);
    setSelected(moment.id);
    setOverlay(true);
    seekTo(at);
  }

  return (
    <div
      className={`guided-replay${expanded ? " video-replay-expanded" : ""}`}
      ref={container}
    >
      <div className="guided-replay-heading">
        <span>
          <Sparkles size={18} aria-hidden="true" /> Your lift, with Coach
        </span>
        <button
          className="video-icon-button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Reduce video" : "Enlarge video"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <X size={22} aria-hidden="true" />
          ) : (
            <Expand size={22} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="video-replay-stage">
        <div
          className="video-review-player"
          style={{
            aspectRatio: a ? `${a.width} / ${a.height}` : undefined,
            width: a
              ? `min(100%, calc(min(56dvh, 520px) * ${a.width / a.height}))`
              : "100%",
          }}
        >
          <video
            ref={video}
            src={url}
            playsInline
            muted
            preload="auto"
            aria-label="Saved lifting video"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              if (trackedCanvas.current) trackedCanvas.current.hidden = true;
              capturedTime.current = null;
            }}
            onSeeking={() => {
              setSeeking(true);
              if (trackedCanvas.current) trackedCanvas.current.hidden = true;
              capturedTime.current = null;
            }}
            onEnded={() => {
              setPlaying(false);
              stopAt.current = null;
            }}
            onError={() =>
              setError(
                "This browser could not play the saved clip. Try downloading it from More detail.",
              )
            }
          />
          <canvas
            ref={trackedCanvas}
            className="video-tracked-replay"
            hidden
            role="img"
            aria-label="Segmented video replay"
          />
          {a &&
            (points.length > 0 || trails.length > 0 || regions.length > 0) && (
              <svg
                viewBox={`0 0 ${a.width} ${a.height}`}
                role="img"
                aria-label={
                  points.length
                    ? "Coach focus highlight"
                    : regions.length
                      ? "Tracked object outlines"
                      : "Experimental bar trajectory overlay"
                }
              >
                {regions.map((region) => (
                  <polygon
                    key={region.id}
                    points={region.polygon
                      .map(([x, y]) => `${x * a.width},${y * a.height}`)
                      .join(" ")}
                    fill="none"
                    stroke={region.kind === "plate" ? "#83d5ea" : "#ffde59"}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {trails.map((segment, i) => (
                  <polyline
                    key={i}
                    points={segment
                      .map((p) => `${p.x * a.width},${p.y * a.height}`)
                      .join(" ")}
                    fill="none"
                    stroke="#83d5ea"
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {points.map((p) => (
                  <g key={p.id}>
                    <circle
                      cx={p.x * a.width}
                      cy={p.y * a.height}
                      r={Math.max(12, a.width * 0.035)}
                      fill="#ffde592b"
                      stroke="#ffde59"
                      strokeWidth="3"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={p.x * a.width}
                      cy={p.y * a.height}
                      r="4"
                      fill="#ffde59"
                    />
                  </g>
                ))}
              </svg>
            )}
        </div>
        {active && (
          <div className="video-coach-caption" aria-label="Coaching overlay">
            <span>
              {playing
                ? "WATCH THE MOVEMENT"
                : `INSPECT THE FRAME · ${time.toFixed(2)}s`}
            </span>
            <p>{active.observation}</p>
            <strong>Try next: {active.cue}</strong>
            {!playing && !points.length && active.region !== "whole_lift" && (
              <small>
                Body marker unavailable at this frame. Use the visible evidence
                and cue.
              </small>
            )}
          </div>
        )}
      </div>
      <div className="video-replay-controls">
        {!!a?.segmentation?.frames.some((f) => f.objects.length) && (
          <div>
            <label className="video-check">
              <input
                type="checkbox"
                checked={outlines}
                onChange={(e) => setOutlines(e.target.checked)}
              />
              Tracked replay
            </label>
            <p className="fine-print">
              Yellow: lifter. Blue: plate, when visible. Replay uses the
              analysed frames; switch off for the original video.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                const frames = a.segmentation!.frames.filter(
                  (f) => f.objects.length,
                );
                const nearest = frames.reduce((best, f) =>
                  Math.abs(f.t - time) < Math.abs(best.t - time) ? f : best,
                );
                video.current?.pause();
                setPlaying(false);
                setOutlines(true);
                stopAt.current = null;
                seekTo(nearest.t);
              }}
            >
              Inspect outlines
            </Button>
          </div>
        )}
        <div className="video-playback-row">
          <button
            className="video-icon-button"
            aria-label={playing ? "Pause video" : "Play video"}
            onClick={() => {
              stopAt.current = null;
              if (playing) video.current?.pause();
              else play();
            }}
          >
            {playing ? (
              <Pause size={22} aria-hidden="true" />
            ) : (
              <Play size={22} aria-hidden="true" />
            )}
          </button>
          <input
            aria-label="Video position"
            type="range"
            min="0"
            max={Math.max(0.1, duration)}
            step=".01"
            value={Math.min(time, duration)}
            onChange={(e) => {
              const t = Number(e.target.value);
              stopAt.current = null;
              seekTo(t);
            }}
          />
          <span className="video-clock">
            {stamp(time)} / {stamp(duration)}
          </span>
        </div>
        {!!a?.tracking.points.length && (
          <label className="video-check">
            <input
              type="checkbox"
              checked={barTrail}
              onChange={(e) => setBarTrail(e.target.checked)}
            />
            Experimental bar trail
          </label>
        )}
        <div className="video-playback-options">
          {!!moments.length && (
            <label className="video-check">
              <input
                type="checkbox"
                checked={overlay}
                onChange={(e) => setOverlay(e.target.checked)}
              />
              Coach overlay
            </label>
          )}
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => {
              setSpeed(e.target.value);
              if (video.current)
                video.current.playbackRate = Number(e.target.value);
            }}
          >
            <option value="1">Normal speed</option>
            <option value="0.5">½ speed</option>
            <option value="0.25">¼ speed</option>
          </select>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!coaching && a?.segmentation?.frames.some((f) => f.objects.length) && (
        <p className="fine-print" role="status">
          {review.status === "failed"
            ? "Your outlines are available. Coach’s feedback could not be completed."
            : "Your outlines are ready. Coach is finishing the feedback automatically."}
        </p>
      )}
      {a?.segmentation &&
        !a.segmentation.frames.some((f) => f.objects.length) && (
          <p className="fine-print" role="status">
            {a.segmentation.failure || !a.segmentation.frames.length
              ? "Outline processing did not finish. This review is incomplete; it does not mean your lift could not be tracked."
              : "The athlete or plates could not be tracked confidently in the sampled frames. No outlines are shown."}
          </p>
        )}
      {coaching && (
        <section className="video-coaching-cards" aria-label="Guided coaching">
          {!moments.length && (
            <p className="fine-print">
              <strong>No supported correction markers</strong>
              <br />
              Coach could not establish a specific correction from the frames it
              reviewed. This does not mean every part of your lift was assessed.
            </p>
          )}
          {coaching.scope === "visible_phases" && (
            <p className="fine-print">
              <strong>Feedback on the visible movement</strong>
              <br />
              Some phases could not be assessed. These cues cover only what
              Coach could see.
            </p>
          )}
          {moments.map((m, i) => (
            <article
              key={m.id}
              className={`video-coaching-card${i === 0 ? " primary" : ""}`}
            >
              <span className="eyebrow">
                {m.attemptLabel ? `${m.attemptLabel} · ` : ""}
                {i === 0 ? "YOUR NEXT STEP" : "ALSO NOTICE"} ·{" "}
                {m.evidenceTime.toFixed(2)}s
              </span>
              <h3>{m.title}</h3>
              <p>{m.observation}</p>
              <div className="video-next-cue">
                <strong>Try next</strong>
                <p>{m.cue}</p>
              </div>
              <div className="video-evidence-actions">
                <Button
                  onClick={() => inspect(m)}
                  variant={i === 0 ? "default" : "secondary"}
                >
                  Freeze &amp; inspect
                </Button>
                <Button variant="secondary" onClick={() => replay(m)}>
                  <RotateCcw size={18} aria-hidden="true" />
                  Watch this moment
                </Button>
              </div>
              {m.evidenceTimes.length > 1 && (
                <div
                  className="video-evidence-frames"
                  aria-label="Supporting frames"
                >
                  {m.evidenceTimes.map((t, j) => (
                    <button
                      type="button"
                      key={t}
                      aria-label={`Inspect evidence frame at ${t.toFixed(2)} seconds`}
                      onClick={() => inspect(m, t)}
                    >
                      {j + 1} · {t.toFixed(2)}s
                    </button>
                  ))}
                </div>
              )}
              <p className="fine-print">{m.check}</p>
            </article>
          ))}
          {coaching.strength && (
            <p className="video-strength">
              <strong>
                {coaching.scope === "visible_phases"
                  ? "What Coach could observe"
                  : "Keep doing this"}
              </strong>
              <br />
              {coaching.strength}
            </p>
          )}
          {coaching.limitation && (
            <p className="fine-print">{coaching.limitation}</p>
          )}
        </section>
      )}
    </div>
  );
}
