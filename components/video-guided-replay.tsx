"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Expand, X, RotateCcw, Sparkles } from "./ui/icons";
import { Button } from "./ui/button";
import type { SavedVideoReview } from "@/lib/video/types";
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
  const stopAt = useRef<{ end: number; freeze: number } | null>(null);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [seeking, setSeeking] = useState(false),
    [speed, setSpeed] = useState("1");
  const [overlay, setOverlay] = useState(true),
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
  const trails = a && barTrail ? barTrailSegments(a, time) : [];

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0,
      fallback = 0,
      closed = false;
    const sync = (presentedTime: number) => {
      if (closed || v.seeking) return;
      // Safari can deliver an older queued presentation callback after a seek
      // or resize. It must not replace the paused inspection position.
      const t = v.paused ? v.currentTime : presentedTime;
      setTime(t);
      onTime(t);
      if (stopAt.current !== null && t >= stopAt.current.end - 0.035) {
        const freeze = stopAt.current.freeze;
        v.pause();
        stopAt.current = null;
        v.currentTime = freeze;
        setTime(freeze);
        onTime(freeze);
      }
    };
    const seek = () => sync(v.currentTime);
    v.addEventListener("seeked", seek);
    if (typeof v.requestVideoFrameCallback === "function") {
      const frame: VideoFrameRequestCallback = (_now, metadata) => {
        sync(metadata.mediaTime);
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
      v.removeEventListener("seeked", seek);
      if (handle) v.cancelVideoFrameCallback(handle);
      if (fallback) cancelAnimationFrame(fallback);
    };
  }, [url, onTime]);

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
  function replay(moment: CoachingMoment) {
    const v = video.current;
    if (!v) return;
    setSelected(moment.id);
    setOverlay(true);
    setSpeed("0.5");
    v.playbackRate = 0.5;
    v.currentTime = moment.start;
    stopAt.current = { end: moment.end, freeze: moment.evidenceTime };
    setTime(moment.start);
    onTime(moment.start);
    play();
    container.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }
  function inspect(moment: CoachingMoment, at = moment.evidenceTime) {
    const v = video.current;
    if (!v) return;
    stopAt.current = null;
    v.pause();
    setPlaying(false);
    setSelected(moment.id);
    setOverlay(true);
    v.currentTime = at;
    setTime(at);
    onTime(at);
    container.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
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
            preload="metadata"
            aria-label="Saved lifting video"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeking={() => setSeeking(true)}
            onSeeked={() => setSeeking(false)}
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
          {overlay && a && (points.length > 0 || trails.length > 0) && (
            <svg
              viewBox={`0 0 ${a.width} ${a.height}`}
              role="img"
              aria-label={
                points.length
                  ? "Coach focus highlight"
                  : "Experimental bar trajectory overlay"
              }
            >
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
              if (video.current) video.current.currentTime = t;
              setTime(t);
              onTime(t);
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
          <label className="video-check">
            <input
              type="checkbox"
              checked={overlay}
              onChange={(e) => setOverlay(e.target.checked)}
            />
            Coach overlay
          </label>
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
      {coaching && (
        <section className="video-coaching-cards" aria-label="Guided coaching">
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
              <strong>Keep doing this</strong>
              <br />
              {coaching.strength}
            </p>
          )}
          {coaching.limitation && (
            <p className="fine-print">{coaching.limitation}</p>
          )}
          {!moments.length && !coaching.limitation && (
            <p>No specific correction is supported by this view.</p>
          )}
        </section>
      )}
    </div>
  );
}
