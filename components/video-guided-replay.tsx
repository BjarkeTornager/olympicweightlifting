"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Expand, X, RotateCcw, Sparkles } from "./ui/icons";
import { Button } from "./ui/button";
import type { SavedVideoReview } from "@/lib/video/types";
import { segmentationAt, trackedReplayAction } from "@/lib/video/segmentation";
import { ghostAt } from "@/lib/video/correction";
import {
  bodyFrameAt,
  bodyReplayAction,
  evidenceSeekTime,
  playbackBodyFor,
} from "@/lib/video/body";
import { techniqueDrills } from "@/lib/video/technique";
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
  const bodyImages = useRef(new Map<string, HTMLImageElement>());
  const stopAt = useRef<{ end: number; freeze: number } | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const [renderTime, setRenderTime] = useState(0);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [seeking, setSeeking] = useState(false),
    [speed, setSpeed] = useState("1");
  const [overlay, setOverlay] = useState(true),
    [outlines, setOutlines] = useState(true),
    [bodyShadow, setBodyShadow] = useState(false),
    [suggestedMovement, setSuggestedMovement] = useState(true),
    [shadowVisibility, setShadowVisibility] = useState("0.8"),
    [barTrail, setBarTrail] = useState(false),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [showCorrection, setShowCorrection] = useState(false),
    [duration, setDuration] = useState(review.analysis?.duration ?? 0);
  const a = review.analysis,
    coaching = currentVideoReview(a) ? a?.coaching : undefined,
    moments = coaching?.moments ?? [];
  const motionClips =
    a?.body?.motion?.clips.filter((c) => c.frames.some((f) => f.image)) ?? [];
  const motionClip =
    motionClips.find((c) => c.id === selected) ?? motionClips[0];
  const movement = Boolean(suggestedMovement && motionClip);
  const playbackBody = useMemo(
    () => playbackBodyFor(a?.body, selected, suggestedMovement),
    [a, selected, suggestedMovement],
  );
  const showBody = bodyShadow || movement;
  const motionCue = moments.find((m) => m.id === motionClip?.id);
  const active = overlay
    ? (moments.find(
        (m) => m.id === selected && time >= m.start && time <= m.end,
      ) ?? moments.find((m) => time >= m.start && time <= m.end))
    : undefined;
  const points =
    a && active && !movement && !playing && !seeking
      ? evidenceFocusPoints(a, active, time)
      : [];
  const ghost =
    active && showCorrection && !playing && !seeking
      ? ghostAt(active.correctionPreview, time)
      : null;
  const trails =
    a && barTrail && !seeking
      ? barTrailSegments(a, playing ? renderTime : time)
      : [];
  const regions =
    outlines && !movement && !playing && !seeking
      ? segmentationAt(a?.segmentation, time)
      : [];
  const bodyFrame =
    showBody && !playing && !seeking
      ? bodyFrameAt(playbackBody, time)
      : undefined;
  const bodyFrames = a?.body?.frames.filter((f) => f.image) ?? [];

  useEffect(() => {
    bodyImages.current.clear();
  }, [url, playbackBody]);

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
        (outlines || showBody) &&
        canvas &&
        a &&
        v.videoWidth === a.width &&
        v.videoHeight === a.height
      ) {
        // Warm only a small window of body textures; a long review must not
        // decode hundreds of full-size images in a phone's memory at once.
        if (showBody && playbackBody) {
          const nearest = playbackBody.frames.findIndex((f) => f.t >= t - 0.02);
          const window = playbackBody.frames.slice(
            Math.max(0, nearest - 1),
            Math.max(0, nearest - 1) + 6,
          );
          const wanted = new Set(
            window.flatMap((f) => (f.image ? [f.image] : [])),
          );
          for (const key of bodyImages.current.keys())
            if (!wanted.has(key)) bodyImages.current.delete(key);
          for (const key of wanted)
            if (!bodyImages.current.has(key)) {
              const image = new Image();
              image.src = key;
              bodyImages.current.set(key, image);
            }
        }
        const action = showBody
          ? bodyReplayAction(playbackBody, t, capturedTime.current)
          : trackedReplayAction(segmentation, t, capturedTime.current);
        if (action.kind === "clear") hideTracked();
        else if (action.kind === "capture") {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            // Capture pixels and polygons from the SAME presented source frame.
            // Between samples we retain this complete annotated frame, not a
            // stale polygon over the independently moving original video.
            canvas.width = a.width;
            canvas.height = a.height;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            if (showBody) {
              const frame = bodyFrameAt(playbackBody, action.frame.t);
              const image = frame?.image
                ? bodyImages.current.get(frame.image)
                : undefined;
              if (!image?.complete || !image.naturalWidth) {
                hideTracked();
                setTime(t);
                onTime(t);
                return;
              }
              ctx.globalAlpha = movement ? Number(shadowVisibility) : 1;
              ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
              ctx.globalAlpha = 1;
            }
            ctx.lineWidth = (2.5 * canvas.width) / Math.max(1, v.clientWidth);
            for (const region of showBody
              ? []
              : segmentationAt(segmentation, action.frame.t)) {
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
            canvas.dataset.overlayKind = movement ? "suggested" : "observed";
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
        const target = evidenceSeekTime(freeze, v.duration);
        pendingSeek.current = target;
        setSeeking(true);
        v.currentTime = target;
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
  }, [
    url,
    onTime,
    outlines,
    showBody,
    playbackBody,
    movement,
    shadowVisibility,
    a,
  ]);

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
    const target = evidenceSeekTime(
      at,
      Number.isFinite(v.duration) ? v.duration : Infinity,
    );
    pendingSeek.current = target;
    setSeeking(true);
    // A click may arrive before Safari has decoded the blob's metadata.
    // Retain the requested frame until a media readiness event can apply it.
    if (
      !v.seeking &&
      v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      Math.abs(v.currentTime - target) < 0.0001
    ) {
      pendingSeek.current = null;
      setSeeking(false);
    } else if (v.readyState >= HTMLMediaElement.HAVE_METADATA)
      v.currentTime = target;
    setTime(at);
    onTime(at);
  }
  function replay(moment: CoachingMoment) {
    const v = video.current;
    if (!v) return;
    v.scrollIntoView({ block: "center", behavior: "instant" });
    setSelected(moment.id);
    setShowCorrection(false);
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

  function showGuide(moment: CoachingMoment) {
    inspect(moment);
    setOutlines(false);
    const motion = motionClips.some((c) => c.id === moment.id);
    setSuggestedMovement(motion);
    setShowCorrection(!motion);
    setBodyShadow(false);
  }

  function inspectBody(at: number) {
    video.current?.scrollIntoView({ block: "center", behavior: "instant" });
    video.current?.pause();
    setPlaying(false);
    stopAt.current = null;
    setBodyShadow(true);
    setSuggestedMovement(false);
    setOutlines(false);
    setShowCorrection(false);
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
            aria-label={
              movement ? "Suggested movement replay" : "Segmented video replay"
            }
          />
          {bodyFrame?.image && (
            // This private, validated PNG is already the exact source-frame projection.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="video-body-shadow"
              style={{ opacity: movement ? Number(shadowVisibility) : 1 }}
              src={bodyFrame.image}
              alt={
                movement
                  ? "Suggested movement silhouette"
                  : "Observed 3D body reconstruction"
              }
              data-frame-time={bodyFrame.t}
            />
          )}
          {a &&
            (points.length > 0 ||
              trails.length > 0 ||
              regions.length > 0 ||
              ghost) && (
              <svg
                viewBox={`0 0 ${a.width} ${a.height}`}
                role="img"
                aria-label={
                  ghost
                    ? "Suggested posture correction"
                    : points.length
                      ? "Coach focus highlight"
                      : regions.length
                        ? "Tracked object outlines"
                        : "Experimental bar trajectory overlay"
                }
              >
                {ghost &&
                  ["observed", "suggested"].map((kind) => {
                    const guide = kind === "suggested";
                    const joints = new Map(
                      (guide ? ghost.suggested : ghost.observed).map((p) => [
                        p.id,
                        p,
                      ]),
                    );
                    return (
                      <g key={kind} opacity={guide ? 0.8 : 0.5}>
                        {ghost.connections.map(([from, to]) => {
                          const p = joints.get(from)!,
                            q = joints.get(to)!;
                          return (
                            <line
                              key={`${from}-${to}`}
                              x1={p.x * a.width}
                              y1={p.y * a.height}
                              x2={q.x * a.width}
                              y2={q.y * a.height}
                              stroke={guide ? "#53ead0" : "#ffffff"}
                              strokeWidth={guide ? 12 : 3}
                              strokeLinecap="round"
                              strokeDasharray={guide ? undefined : "5 5"}
                              vectorEffect="non-scaling-stroke"
                            />
                          );
                        })}
                      </g>
                    );
                  })}
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
                {!ghost &&
                  points.map((p) => (
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
            {ghost && (
              <strong className="video-ghost-label">
                Suggested posture · 2D guide
              </strong>
            )}
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
        {motionClip && (
          <section
            className="video-movement-compare"
            aria-label="Compare your movement"
          >
            <div>
              <strong>{motionCue?.title ?? "Compare your movement"}</strong>
              <p>
                Your video + the suggested position. Scrub or play to compare.
              </p>
            </div>
            <div className="video-evidence-actions">
              <Button
                variant="secondary"
                aria-pressed={!movement && !bodyShadow && !outlines}
                onClick={() => {
                  setSuggestedMovement(false);
                  setBodyShadow(false);
                  setOutlines(false);
                  setShowCorrection(false);
                  setBarTrail(false);
                }}
              >
                Original video
              </Button>
              <Button
                variant="secondary"
                aria-pressed={movement}
                onClick={() => {
                  setSuggestedMovement(true);
                  setBodyShadow(false);
                  setOutlines(false);
                  setShowCorrection(false);
                  video.current?.pause();
                  setPlaying(false);
                  stopAt.current = null;
                  const frames = motionClip.frames.filter((f) => f.image);
                  seekTo(
                    frames.reduce((best, f) =>
                      Math.abs(f.t - time) < Math.abs(best.t - time) ? f : best,
                    ).t,
                  );
                }}
              >
                Suggested movement
              </Button>
              <Button
                onClick={() => {
                  setSelected(motionClip.id);
                  setSuggestedMovement(true);
                  setBodyShadow(false);
                  setOutlines(false);
                  setShowCorrection(false);
                  setSpeed("0.5");
                  if (video.current) video.current.playbackRate = 0.5;
                  const frames = motionClip.frames.filter((f) => f.image);
                  seekTo(frames[0].t);
                  video.current?.scrollIntoView({
                    block: "center",
                    behavior: "instant",
                  });
                  stopAt.current = {
                    end: motionClip.end,
                    freeze: frames.at(-1)!.t,
                  };
                  play();
                }}
              >
                Play comparison
              </Button>
            </div>
            <details className="video-comparison-options">
              <summary>Comparison options</summary>
              <label className="video-shadow-visibility">
                Shadow visibility
                <input
                  aria-label="Shadow visibility"
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.1"
                  value={shadowVisibility}
                  onChange={(e) => setShadowVisibility(e.target.value)}
                />
              </label>
            </details>
            <p className="fine-print" role="status">
              {movement &&
              time >= motionClip.start &&
              time <= motionClip.end + 0.002
                ? "Teal: suggested movement for this cue. Uncertain frames stay clear."
                : `Comparison covers ${motionClip.start.toFixed(2)}–${motionClip.end.toFixed(2)}s. Other phases show your original video.`}
            </p>
          </section>
        )}
        {!motionClip && a?.body?.motion && (
          <p className="fine-print" role="status">
            {a.body.motion.reason}
          </p>
        )}
        {bodyFrames.length > 0 && (
          <details className="video-body-controls">
            <summary>Observed body reconstruction</summary>
            <label className="video-check">
              <input
                type="checkbox"
                checked={bodyShadow}
                onChange={(e) => {
                  if (e.target.checked)
                    inspectBody(
                      bodyFrames.reduce((best, f) =>
                        Math.abs(f.t - time) < Math.abs(best.t - time)
                          ? f
                          : best,
                      ).t,
                    );
                  else setBodyShadow(false);
                }}
              />
              Show observed reconstruction
            </label>
            <p className="fine-print">
              This follows your recorded movement; it is not the correction.
              Hands and hidden positions are approximate. The shadow stays with
              its analysed frame.
            </p>
            <div className="video-evidence-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  inspectBody(
                    bodyFrames.reduce((best, f) =>
                      Math.abs(f.t - time) < Math.abs(best.t - time) ? f : best,
                    ).t,
                  )
                }
              >
                Inspect 3D body
              </Button>
              <Button
                variant="secondary"
                aria-label="Previous body frame"
                disabled={!bodyFrames.some((f) => f.t < time - 0.02)}
                onClick={() =>
                  inspectBody(
                    bodyFrames.filter((f) => f.t < time - 0.02).at(-1)!.t,
                  )
                }
              >
                ← Previous
              </Button>
              <Button
                variant="secondary"
                aria-label="Next body frame"
                disabled={!bodyFrames.some((f) => f.t > time + 0.02)}
                onClick={() =>
                  inspectBody(bodyFrames.find((f) => f.t > time + 0.02)!.t)
                }
              >
                Next →
              </Button>
            </div>
          </details>
        )}
        {a?.body?.status === "unavailable" && (
          <p className="fine-print" role="status">
            {a.body.reason}
          </p>
        )}
        {!!a?.segmentation?.frames.some((f) => f.objects.length) && (
          <div>
            <label className="video-check">
              <input
                type="checkbox"
                checked={outlines}
                onChange={(e) => {
                  setOutlines(e.target.checked);
                  if (e.target.checked) {
                    setBodyShadow(false);
                    setSuggestedMovement(false);
                  }
                }}
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
                setBodyShadow(false);
                setSuggestedMovement(false);
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
      {active?.correctionPreview?.status === "available" &&
        !motionClips.some((c) => c.id === active.id) &&
        !playing && (
          <div
            className="video-correction-compare"
            aria-label="Compare posture"
          >
            <div className="video-evidence-actions">
              <Button
                variant="secondary"
                aria-pressed={!showCorrection && !movement}
                onClick={() => {
                  inspect(active);
                  setShowCorrection(false);
                  setBodyShadow(false);
                  setSuggestedMovement(false);
                }}
              >
                Original position
              </Button>
              <Button
                variant="secondary"
                aria-pressed={showCorrection || movement}
                onClick={() => showGuide(active)}
              >
                Suggested correction
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  inspect(
                    active,
                    active.correctionPreview!.status === "available"
                      ? active.correctionPreview!.ghost.referenceTime
                      : active.evidenceTime,
                  );
                  setShowCorrection(false);
                  setSuggestedMovement(false);
                }}
              >
                Earlier reference
              </Button>
            </div>
            {!movement && (
              <p className="fine-print">
                {active.correctionPreview.ghost.explanation}
              </p>
            )}
            {!movement && (
              <p className="fine-print">
                White dashes: observed position. Teal: suggested position. The
                guide appears only on the inspected frame.
              </p>
            )}
          </div>
        )}
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
          {coaching.previousFocus && (
            <aside className="video-previous-focus">
              <span className="eyebrow">
                YOUR PREVIOUS FOCUS · {coaching.previousFocus.date}
              </span>
              <strong>{coaching.previousFocus.title}</strong>
              <p>{coaching.previousFocus.cue}</p>
              <p className="fine-print">
                A reminder from your last comparable lift. This review assesses
                today’s footage; it does not establish a before-and-after
                change.
              </p>
            </aside>
          )}
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
              {m.certainty === "tentative" && (
                <span className="fine-print">
                  Possible improvement · check this on another comparable
                  attempt
                </span>
              )}
              {m.why && (
                <p>
                  <strong>Why it matters</strong>
                  <br />
                  {m.why}
                </p>
              )}
              <div className="video-next-cue">
                <strong>Try next</strong>
                <p>{m.cue}</p>
              </div>
              <div className="video-evidence-actions">
                {m.correctionPreview?.status === "available" && (
                  <Button onClick={() => showGuide(m)}>
                    Show suggested correction
                  </Button>
                )}
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
              {m.correctionPreview?.status === "unavailable" && (
                <p className="fine-print">{m.correctionPreview.reason}</p>
              )}
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
              {m.practice && (
                <div className="video-practice">
                  <strong>Practise this</strong>
                  <p>{m.practice}</p>
                  {m.drill && techniqueDrills[m.drill] && (
                    <a
                      href={techniqueDrills[m.drill].url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Watch: {techniqueDrills[m.drill].name} ↗
                    </a>
                  )}
                </div>
              )}
              <p>
                <strong>On your next attempt</strong>
                <br />
                {m.check}
              </p>
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
          {!!coaching.checks?.length && (
            <details className="video-phase-checks">
              <summary>What Coach reviewed</summary>
              {coaching.checks.map((check, i) => (
                <p key={i}>
                  <strong>
                    {check.phase.replaceAll("_", " ")}
                    {check.status === "not_visible" ? " · not visible" : ""}
                  </strong>
                  <br />
                  {check.observation}
                </p>
              ))}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
