"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { today } from "@/lib/domain";
import type { UserImage } from "@/lib/images";
import {
  sampleLiftingVideo,
  saveVideoSheet,
  type VideoSheet,
} from "@/lib/lifting-video-client";
import {
  videoLifts,
  videoReviewPrompt,
  videoSampleTimes,
  type VideoLift,
} from "@/lib/lifting-video";

export function LiftingVideoDialog({
  accountId,
  hasAttachments,
  onClose,
  onPrepared,
}: {
  accountId: string;
  hasAttachments: boolean;
  onClose: () => void;
  onPrepared: (photos: UserImage[], prompt: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState("0"),
    [end, setEnd] = useState("");
  const [lift, setLift] = useState<VideoLift>("Snatch");
  const [load, setLoad] = useState(""),
    [question, setQuestion] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{
    sheets: VideoSheet[];
    prompt: string;
  } | null>(null);
  const saved = useRef<UserImage[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [largeSheet, setLargeSheet] = useState<VideoSheet | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  function select(file?: File) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("video/") || file.size > 100 * 1024 * 1024) {
      setError(
        "Choose a video smaller than 100 MB. MP4 (H.264) works in the widest range of browsers.",
      );
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setUrl(objectUrl.current);
    setDuration(0);
    setPrepared(null);
    saved.current = [];
    setSavedCount(0);
    setStart("0");
    setEnd("");
  }
  async function prepare() {
    if (!video.current || !duration || busy) return;
    setError("");
    try {
      videoSampleTimes(Number(start), Number(end), duration);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]);
    setBusy(true);
    setStatus("Preparing 24 frames on this device…");
    try {
      // WebKit can suspend seeking in an offscreen player. Let the compact
      // preparation view render, then keep the real player visible throughout.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      signal.throwIfAborted();
      video.current.scrollIntoView({ block: "center", behavior: "instant" });
      const group = crypto.randomUUID().slice(0, 8);
      const result = await sampleLiftingVideo(
        video.current,
        Number(start),
        Number(end),
        date,
        lift,
        group,
        signal,
        (done) => setStatus(`Preparing frame ${done} of 24…`),
      );
      signal.throwIfAborted();
      setPrepared({
        sheets: result.sheets,
        prompt: videoReviewPrompt(lift, load, question, result.times, group),
      });
      setStatus("");
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Could not prepare frames. Try another clip.",
        );
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        setStatus("");
      }
    }
  }
  async function attach() {
    if (!prepared || hasAttachments || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      // Retain IDs and successful uploads across a retry; never duplicate a partial save.
      for (const sheet of prepared.sheets) {
        if (saved.current.some((photo) => photo.id === sheet.id)) continue;
        setStatus(`Saving frame sheet ${saved.current.length + 1} of 4…`);
        const photo = await saveVideoSheet(sheet, accountId, abort.signal);
        abort.signal.throwIfAborted();
        saved.current.push(photo);
        setSavedCount(saved.current.length);
      }
      onPrepared([...saved.current], prepared.prompt);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          `${e instanceof Error ? e.message : "Could not save frames."} Retry to continue. Any saved sheets remain in your private Activity image library.`,
        );
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        setStatus("");
      }
    }
  }
  return (
    <Dialog
      open
      title="Review a lifting video"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div
        className={`lifting-video-flow${busy && !prepared ? " lifting-video-preparing" : ""}`}
      >
        <p className="muted">
          Choose a short section of one lift. Coach reviews 24 sampled frames
          and helps you choose one improvement to try.
        </p>
        <details>
          <summary>How to film a useful clip</summary>
          <p>
            Keep the camera steady and your whole body, feet and bar in view. A
            front-side angle is a useful starting point. Include the setup and
            receiving position; choose a shorter section to examine a fast phase
            more closely.
          </p>
          <p>
            Good light and a clear view matter. Review the clean and jerk
            separately if the full attempt is longer than six seconds.
          </p>
          <a
            href="https://www.catalystathletics.com/article/2254/Using-Video-in-Training-Most-Effectively/"
            target="_blank"
            rel="noreferrer"
          >
            Filming advice · Catalyst Athletics
          </a>
        </details>
        {hasAttachments && (
          <p role="alert">
            A video review uses all four image slots. Finish your current image
            message, or remove its attachments, before adding a video review.
          </p>
        )}
        {!prepared && (
          <>
            <label>
              Choose video
              <input
                type="file"
                accept="video/*"
                aria-label="Choose lifting video"
                disabled={busy || hasAttachments}
                onChange={(e) => {
                  select(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {url && (
              <video
                key={url}
                ref={video}
                src={url}
                controls={!busy}
                playsInline
                muted
                preload="auto"
                aria-label="Your selected lifting clip"
                onLoadedMetadata={(e) => {
                  const seconds = e.currentTarget.duration;
                  if (
                    !Number.isFinite(seconds) ||
                    seconds < 0.5 ||
                    seconds > 120
                  ) {
                    setError(
                      "Choose a clip between 0.5 seconds and two minutes long.",
                    );
                    setDuration(0);
                  } else {
                    setDuration(seconds);
                    setEnd(
                      Math.min(6, Math.floor(seconds * 100) / 100).toString(),
                    );
                  }
                }}
                onError={() => {
                  setDuration(0);
                  setError(
                    "This video format could not be opened. Export it as an MP4 (H.264), or use still photos.",
                  );
                }}
              />
            )}
            <div className="lifting-video-fields">
              <label>
                Lift
                <select
                  aria-label="Lift in video"
                  value={lift}
                  disabled={busy}
                  onChange={(e) => setLift(e.target.value as VideoLift)}
                >
                  {videoLifts.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Load, if known
                <input
                  aria-label="Video load"
                  value={load}
                  maxLength={80}
                  placeholder="e.g. 60 kg"
                  disabled={busy}
                  onChange={(e) => setLoad(e.target.value)}
                />
              </label>
              <label>
                Start (seconds)
                <input
                  aria-label="Clip start seconds"
                  type="number"
                  min="0"
                  step="0.01"
                  max={duration || undefined}
                  value={start}
                  disabled={busy || !duration}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                End (seconds)
                <input
                  aria-label="Clip end seconds"
                  type="number"
                  min="0.5"
                  step="0.01"
                  max={duration || undefined}
                  value={end}
                  disabled={busy || !duration}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <Button
                variant="ghost"
                disabled={busy || !duration}
                onClick={() =>
                  setStart((video.current?.currentTime ?? 0).toFixed(2))
                }
              >
                Use current time as start
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !duration}
                onClick={() =>
                  setEnd((video.current?.currentTime ?? 0).toFixed(2))
                }
              >
                Use current time as end
              </Button>
            </div>
            <label>
              Training date
              <input
                type="date"
                aria-label="Video training date"
                value={date}
                required
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              What did you notice?
              <textarea
                aria-label="Video question"
                value={question}
                maxLength={600}
                rows={2}
                placeholder="Optional: what felt difficult, or what you want checked"
                disabled={busy}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <Button
              disabled={
                busy || !duration || !date || !start || !end || hasAttachments
              }
              onClick={() => void prepare()}
            >
              Preview selected frames
            </Button>
          </>
        )}
        {prepared && (
          <>
            <p>
              Check that these frames cover the part you want reviewed. Each
              sheet reads across, then down.
            </p>
            <div className="lifting-video-sheets">
              {prepared.sheets.map((sheet, i) => (
                <figure key={sheet.id}>
                  <button
                    type="button"
                    className="photo-thumbnail"
                    aria-label={`Enlarge frame sheet ${i + 1}`}
                    aria-haspopup="dialog"
                    onClick={() => setLargeSheet(sheet)}
                  >
                    {/* Local previews have no public image URL and are not yet uploaded. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/jpeg;base64,${sheet.image}`}
                      alt={`Preview sheet ${i + 1}: six numbered video frames with timestamps`}
                    />
                  </button>
                  <figcaption>Sheet {i + 1} of 4</figcaption>
                </figure>
              ))}
            </div>
            {largeSheet && (
              <Dialog
                open
                onOpenChange={(open) => {
                  if (!open) setLargeSheet(null);
                }}
                title="Selected video frames"
                className="photo-viewer"
              >
                <div className="photo-viewer-content">
                  <div className="food-photo-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/jpeg;base64,${largeSheet.image}`}
                      alt={largeSheet.label}
                      width={1280}
                      height={1920}
                    />
                  </div>
                </div>
              </Dialog>
            )}
            <div className="button-row">
              <Button
                disabled={busy || hasAttachments}
                onClick={() => void attach()}
              >
                Save frames & add to message
              </Button>
              <Button
                variant="ghost"
                disabled={busy || savedCount > 0}
                onClick={() => {
                  setPrepared(null);
                  setUrl("");
                  setDuration(0);
                }}
              >
                Choose another clip
              </Button>
            </div>
          </>
        )}
        {status && (
          <p role="status" className="lifting-video-progress">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <p className="fine-print">
          The original video and audio stay on this device. Saving stores four
          frame sheets privately in Images → Activity. Sending the message
          shares those frames with your configured Coach provider. Nothing is
          logged as a workout.
        </p>
        <p className="fine-print">
          Experimental visual feedback: sampled frames can miss fast movement.
          This does not measure bar speed, joint angles or injury risk. Keep the
          original clip if you want to review it again.
        </p>
      </div>
    </Dialog>
  );
}
