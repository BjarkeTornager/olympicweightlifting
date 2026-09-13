"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Expand, X, RotateCcw } from "./ui/icons";
import { Button } from "./ui/button";
import type { SavedVideoReview } from "@/lib/video/types";
import { evidenceSeekTime } from "@/lib/video/body";
import { techniqueDrills } from "@/lib/video/technique";
import {
  createOverlayTrack,
  renderOverlays,
  type OverlayOptions,
} from "@/lib/video/overlay-renderer";

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
    canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const presented = useRef<number | null>(null),
    pending = useRef<number | null>(null);
  const draw = useRef<(time: number) => void>(() => {});
  const lastUi = useRef(0);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(review.analysis?.duration ?? 0);
  const [speed, setSpeed] = useState("1"),
    [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const track = useMemo(
    () => createOverlayTrack(review.analysis),
    [review.analysis],
  );
  const [options, setOptions] = useState<OverlayOptions>(() => ({
    form: track.formAvailable,
    outline: !track.formAvailable,
    bar: false,
    cues: true,
    body: false,
  }));
  const a = review.analysis;
  const available = {
    form: track.formAvailable,
    body: track.bodyAvailable,
    outline: track.outlines.some((f) => f.objects.length),
    bar: Boolean(a?.tracking.points.length),
    cues: Boolean(track.moments.length || track.observations.length),
  };
  const selectedCue = track.moments.find(
    (m) => time >= m.start && time <= m.end,
  );
  const selectedObservation =
    !selectedCue &&
    track.observations.find((o) => time >= o.start && time < o.end);

  useEffect(() => {
    const v = video.current,
      c = canvas.current;
    if (!v || !c) return;
    draw.current = (t) => {
      if (!Number.isFinite(t) || v.readyState < 2 || !v.videoWidth) return;
      const frameDuration = a
        ? a.duration / Math.max(1, a.frameCount - 1)
        : 1 / 30;
      if (
        v.paused &&
        Math.abs(t - v.currentTime) > Math.max(0.018, frameDuration + 0.003)
      )
        return;
      if (pending.current !== null) {
        // Safari can fire seeked before it presents the new pixels. Use the
        // decoder's timestamp, not currentTime, to release the overlay.
        const atRequestedFrame =
          t <= pending.current + 0.002 &&
          pending.current - t <= Math.max(0.018, frameDuration + 0.003);
        // Playback may resume before WebKit presents the requested still. The
        // first *newer* decoded frame is valid too; waiting forever for that
        // skipped frame would leave the overlay hidden for the entire replay.
        const resumedAfterSeek =
          !v.paused &&
          t >= pending.current - frameDuration &&
          Math.abs(t - v.currentTime) < 0.1;
        if (v.seeking || (!atRequestedFrame && !resumedAfterSeek)) return;
        pending.current = null;
      }
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      // Bound decoded texture memory on phones. The continuous silhouette is
      // already available while a 3D reconstruction texture is loading.
      const groups = [
        a?.body?.frames ?? [],
        ...track.motion
          .filter((c) => t >= c.start - 0.15 && t <= c.end + 0.15)
          .map((c) => c.frames),
      ];
      const wanted = new Set(
        groups.flatMap((frames) => {
          const next = frames.findIndex((f) => f.t >= t);
          const start = Math.max(0, (next < 0 ? frames.length - 1 : next) - 1);
          return frames
            .slice(start, start + 4)
            .flatMap((f) => (f.image ? [f.image] : []));
        }),
      );
      for (const key of images.current.keys())
        if (!wanted.has(key)) images.current.delete(key);
      if (options.form || options.body)
        for (const key of wanted)
          if (!images.current.has(key)) {
            const image = new Image();
            image.src = key;
            images.current.set(key, image);
            image.onload = () => {
              if (v.paused && presented.current !== null)
                draw.current(presented.current);
            };
          }
      const ctx = c.getContext("2d");
      if (ctx) {
        const result = renderOverlays(ctx, track, t, options, images.current);
        c.dataset.frameTime = t.toFixed(6);
        c.dataset.layers = String(result.count);
        c.dataset.phase = result.phase;
        c.hidden = false;
      }
      if (v.paused || performance.now() - lastUi.current > 80) {
        lastUi.current = performance.now();
        setTime(v.currentTime);
        onTime(v.currentTime);
      }
    };
    if (presented.current !== null) draw.current(presented.current);
  }, [track, options, a, onTime]);

  // One callback chain for the lifetime of this source. Toggling a layer must
  // not cancel/restart the paused-frame decoder listener (especially WebKit).
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    presented.current = null;
    pending.current = null;
    const imageCache = images.current;
    imageCache.clear();
    let frame = 0,
      fallback = 0,
      closed = false;
    const hasFrameCallback = typeof v.requestVideoFrameCallback === "function";
    const receive = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (closed) return;
      frame = v.requestVideoFrameCallback(receive);
      presented.current = metadata.mediaTime;
      draw.current(metadata.mediaTime);
    };
    const refresh = () => {
      if (!hasFrameCallback && !v.seeking && v.readyState >= 2)
        presented.current = v.currentTime;
      if (presented.current !== null) draw.current(presented.current);
    };
    if (hasFrameCallback) frame = v.requestVideoFrameCallback(receive);
    else {
      const tick = () => {
        refresh();
        fallback = requestAnimationFrame(tick);
      };
      fallback = requestAnimationFrame(tick);
    }
    v.addEventListener("seeked", refresh);
    v.addEventListener("loadeddata", refresh);
    v.addEventListener("pause", refresh);
    return () => {
      closed = true;
      if (hasFrameCallback) v.cancelVideoFrameCallback(frame);
      cancelAnimationFrame(fallback);
      v.removeEventListener("seeked", refresh);
      v.removeEventListener("loadeddata", refresh);
      v.removeEventListener("pause", refresh);
      for (const image of imageCache.values()) image.onload = null;
      imageCache.clear();
    };
  }, [url]);

  useEffect(() => {
    if (!expanded) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", escape, true);
    };
  }, [expanded]);

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    const target = Math.min(Math.max(0, t), duration);
    pending.current = target;
    if (canvas.current) canvas.current.hidden = true;
    if (v.readyState > 0) v.currentTime = target;
    setTime(target);
    onTime(target);
    if (!v.seeking && presented.current !== null)
      draw.current(presented.current);
  }
  function play() {
    const v = video.current;
    if (!v) return;
    if (v.ended || v.currentTime >= duration - 0.02) seek(0);
    void v
      .play()
      .catch(() =>
        setError("Playback could not start. Tap Play to try again."),
      );
  }
  function watch(t: number) {
    seek(evidenceSeekTime(Math.max(0, t - 0.35), duration));
    container.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    play();
  }

  return (
    <div
      className={`guided-replay video-simple-replay${expanded ? " video-replay-expanded" : ""}`}
      ref={container}
    >
      <div className="guided-replay-heading">
        <h3>
          {a?.identification?.lift ??
            (review.lift === "Identify from video" ? "Your lift" : review.lift)}
          {review.load ? ` · ${review.load}` : ""}
        </h3>
        <button
          className="video-icon-button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Reduce video" : "Enlarge video"}
          aria-expanded={expanded}
        >
          {expanded ? <X size={22} /> : <Expand size={22} />}
        </button>
      </div>
      <div className="video-replay-stage">
        <div
          className="video-review-player"
          style={{
            aspectRatio: a ? `${a.width} / ${a.height}` : undefined,
            width: a
              ? `min(100%, calc(min(${expanded ? 56 : 48}dvh, 520px) * ${a.width / a.height}))`
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
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              if (pending.current !== null)
                e.currentTarget.currentTime = pending.current;
            }}
            onClick={() => (playing ? video.current?.pause() : play())}
            onPlay={() => {
              setError("");
              setPlaying(true);
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onSeeking={(e) => {
              pending.current = e.currentTarget.currentTime;
              if (canvas.current) canvas.current.hidden = true;
            }}
            onError={() =>
              setError(
                "This browser could not play the clip. Download it from Review details.",
              )
            }
          />
          <canvas
            ref={canvas}
            className="video-tracked-replay"
            hidden
            role="img"
            aria-label="Synchronized video overlays"
          />
        </div>
      </div>
      <div className="video-playback-row">
        <button
          className="video-icon-button"
          aria-label={playing ? "Pause video" : "Play video"}
          onClick={() => (playing ? video.current?.pause() : play())}
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <input
          aria-label="Video position"
          type="range"
          min="0"
          max={Math.max(0.1, duration)}
          step="0.001"
          value={Math.min(time, duration)}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="video-clock">
          {stamp(time)} / {stamp(duration)}
        </span>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => {
            setSpeed(e.target.value);
            if (video.current)
              video.current.playbackRate = Number(e.target.value);
          }}
        >
          <option value="1">1×</option>
          <option value="0.5">½×</option>
          <option value="0.25">¼×</option>
        </select>
      </div>
      <div
        className="video-overlay-toggles"
        role="group"
        aria-label="Video overlays"
      >
        {(
          [
            ["form", "Form guide"],
            ["outline", "Body outline"],
            ["body", "3D body"],
            ["bar", "Bar path"],
            ["cues", "Coach cues"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            disabled={!available[key]}
            aria-pressed={available[key] && options[key]}
            title={
              !available[key]
                ? `${label} is unavailable for this review`
                : undefined
            }
            onClick={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}
          >
            <span className={`video-overlay-dot ${key}`} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {options.form && available.form && (
        <span className="video-form-legend">
          Teal: suggested · Grey: recorded transition
        </span>
      )}
      {options.cues && selectedCue && (
        <p className="video-live-cue" aria-label="Coaching overlay">
          <strong>Try this</strong> {selectedCue.cue}
        </p>
      )}
      {options.cues && selectedObservation && (
        <p className="video-live-cue" aria-label="Coaching observation">
          <strong>{selectedObservation.title}</strong>{" "}
          {selectedObservation.observation}
        </p>
      )}
      {options.body && available.body && (
        <p className="fine-print">
          3D body shows your recorded position. Form guide shows supported
          adjustments.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!available.form && (
        <p className="fine-print video-overlay-availability">
          {track.guide.reason}
        </p>
      )}
      {!!track.moments.length && (
        <section className="video-coaching-cards" aria-label="Guided coaching">
          {track.moments.map((moment, i) => {
            const content = (
              <>
                <p>{moment.observation}</p>
                <div className="video-next-cue">
                  <strong>Try next</strong>
                  <p>{moment.cue}</p>
                </div>
                <Button variant="secondary" onClick={() => watch(moment.start)}>
                  <RotateCcw size={18} aria-hidden="true" /> Watch this moment ·{" "}
                  {stamp(moment.evidenceTime)}
                </Button>
                <details className="video-cue-details">
                  <summary>Why & how to practise</summary>
                  {moment.why && <p>{moment.why}</p>}
                  {moment.practice && <p>{moment.practice}</p>}
                  {moment.drill && techniqueDrills[moment.drill] && (
                    <a
                      href={techniqueDrills[moment.drill].url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Watch: {techniqueDrills[moment.drill].name} ↗
                    </a>
                  )}
                  <p>
                    <strong>Next attempt:</strong> {moment.check}
                  </p>
                  {moment.certainty === "tentative" && (
                    <p className="fine-print">
                      Possible improvement · check another comparable attempt.
                    </p>
                  )}
                </details>
              </>
            );
            return i === 0 ? (
              <article key={moment.id} className="video-coaching-card primary">
                <span className="eyebrow">
                  YOUR NEXT STEP
                  {moment.attemptLabel ? ` · ${moment.attemptLabel}` : ""}
                </span>
                <h3>{moment.title}</h3>
                {content}
              </article>
            ) : (
              <details key={moment.id} className="video-coaching-card">
                <summary>{moment.title}</summary>
                {content}
              </details>
            );
          })}
        </section>
      )}
      {!track.moments.length && a?.coaching && (
        <p className="fine-print">
          {a.coaching.limitation ||
            "Coach did not identify a specific correction from the visible evidence."}
        </p>
      )}
      {!a?.coaching && available.outline && (
        <p className="fine-print">
          {review.status === "failed"
            ? "Your outlines are available. Coach’s feedback could not be completed."
            : "Your outlines are ready. Coach is finishing the feedback automatically."}
        </p>
      )}
      <details className="video-review-tools">
        <summary>Overlay details</summary>
        <p>
          {track.guide.available
            ? track.guide.reason
            : track.formAvailable
              ? "This review includes a reconstructed 3D correction for the supported coaching interval. Other phases need more continuous body tracking for an animated guide."
              : track.guide.reason}
        </p>
        <p className="fine-print">
          The form guide is an illustrative animation, not a verified perfect
          lift. Body outlines and intermediate positions are interpolated for
          smooth playback. Tracking gaps and hidden joints remain unavailable.
          Bar paths are camera-plane estimates.
        </p>
        {a?.coaching?.strength && (
          <p>
            <strong>Keep doing:</strong> {a.coaching.strength}
          </p>
        )}
        {a?.coaching?.checks?.map((check) => (
          <p key={check.phase}>
            <strong>{check.phase.replaceAll("_", " ")}:</strong>{" "}
            {check.observation}
          </p>
        ))}
        {a?.coaching?.limitation && (
          <p className="fine-print">{a.coaching.limitation}</p>
        )}
        {!available.outline && a?.segmentation && (
          <p className="fine-print">
            {a.segmentation.failure
              ? "Outline processing did not finish. Update the analysis to retry."
              : a.segmentation.reason}
          </p>
        )}
        {!available.bar && (
          <p className="fine-print">
            {a?.tracking.status === "not_requested"
              ? "This older review did not run automatic bar tracking. Update the analysis to add it."
              : a?.tracking.reason}
          </p>
        )}
        {!available.body && a?.body && (
          <p className="fine-print">{a.body.reason}</p>
        )}
      </details>
    </div>
  );
}
