"use client";
import { useEffect, useRef } from "react";
import { useVoiceCheckin, type VoiceStatus } from "@/lib/use-voice-checkin";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Camera, Check, LoaderCircle, Mic, MicOff, PhoneOff } from "./ui/icons";

const statusText = {
  idle: "Coach asks what’s missing for today. Just answer out loud.",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Coach is speaking",
  ended: "Call ended. Everything saved is in Coach, with Undo.",
  failed: "",
};

export function VoiceCheckin({
  open,
  onOpenChange,
  accountId,
  headers,
  onSaved,
  onReview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  headers: () => Record<string, string>;
  onSaved: () => void;
  onReview: () => void;
}) {
  const viewfinder = useRef<HTMLVideoElement>(null);
  const voice = useVoiceCheckin({
    accountId,
    headers,
    onSaved,
    video: viewfinder,
  });
  const { camera } = voice;
  useEffect(() => {
    if (viewfinder.current) viewfinder.current.srcObject = camera;
  }, [camera]);
  const live = voice.status === "listening" || voice.status === "speaking";
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [voice.lines]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) voice.stop();
        onOpenChange(next);
      }}
      title="Check in by voice"
      description="A short spoken check-in about today’s training, food and sleep."
      className="voice-checkin"
    >
      {voice.camera ? (
        <div className="voice-camera">
          <video ref={viewfinder} autoPlay playsInline muted />
          <div className="voice-actions">
            <Button
              onClick={() => void voice.shutter()}
              disabled={voice.capturing}
            >
              <Camera size={18} />
              {voice.capturing ? "Saving photo…" : "Take photo"}
            </Button>
            <Button variant="secondary" onClick={voice.closeCamera}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <VoiceVisual
          status={voice.status}
          muted={voice.muted}
          analyser={voice.analyser}
        />
      )}
      <p className="voice-status" role="status">
        {voice.error
          ? voice.error
          : voice.muted && live
            ? "Muted"
            : statusText[voice.status]}
      </p>
      {voice.lines.length > 0 && (
        <div className="voice-transcript" ref={transcript} aria-live="polite">
          {voice.lines.map((line, i) => (
            <p key={i} className={line.role}>
              {line.text}
            </p>
          ))}
        </div>
      )}
      {voice.saves.length > 0 && (
        <ul className="voice-saves" aria-label="Saved from this call">
          {voice.saves.map((save) => (
            <li key={save.id} className={save.state}>
              {save.state === "saving" ? (
                <LoaderCircle size={16} className="spin" />
              ) : save.state === "saved" ? (
                <Check size={16} />
              ) : null}
              <span>
                <strong>{save.label}</strong>{" "}
                {save.state === "saving"
                  ? "saving…"
                  : save.state === "saved"
                    ? "saved"
                    : "not saved yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="voice-actions">
        {live || voice.status === "connecting" ? (
          <>
            <Button
              variant="secondary"
              onClick={voice.toggleMute}
              disabled={!live}
              aria-pressed={voice.muted}
            >
              {voice.muted ? <Mic size={18} /> : <MicOff size={18} />}
              {voice.muted ? "Unmute" : "Mute"}
            </Button>
            <Button variant="danger" onClick={voice.stop}>
              <PhoneOff size={18} /> End
            </Button>
          </>
        ) : (
          <>
            <Button onClick={voice.start}>
              <Mic size={18} />
              {voice.status === "idle" ? "Start talking" : "Talk again"}
            </Button>
            {voice.saves.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  onOpenChange(false);
                  onReview();
                }}
              >
                Review in Coach
              </Button>
            )}
          </>
        )}
      </div>
      <p className="fine-print">
        Your voice goes to Google Gemini for the conversation. Coach saves what
        you report, and you can Undo it.
      </p>
    </Dialog>
  );
}

// Analyser bins (≈190 Hz each at 48 kHz) grouped into speech bands.
const BANDS: [number, number][] = [
  [1, 3],
  [3, 5],
  [5, 9],
  [9, 15],
  [15, 24],
];
const BARS = BANDS.length * 2 - 1;

// The voice made visible: the circle swells and the bars move with whoever is
// speaking, blue for Coach and green for you.
function VoiceVisual({
  status,
  muted,
  analyser,
}: {
  status: VoiceStatus;
  muted: boolean;
  analyser: (who: "coach" | "you") => AnalyserNode | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const bars = [...el.querySelectorAll<HTMLElement>(".voice-bars > span")];
    const reset = () => {
      el.style.setProperty("--level", "0");
      bars.forEach((bar) => (bar.style.height = ""));
    };
    if (
      (status !== "listening" && status !== "speaking") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return reset;
    const who = status === "speaking" ? "coach" : "you";
    const data = new Uint8Array(128);
    let frame = 0;
    const draw = () => {
      const source = who === "you" && muted ? null : analyser(who);
      if (source) source.getByteFrequencyData(data);
      else data.fill(0);
      // Five bands from low to high speech frequencies, mirrored so the
      // strongest sits in the middle; higher bands are quieter, so boost them.
      const bands = BANDS.map(([from, to], k) => {
        let sum = 0;
        for (let j = from; j < to; j++) sum += data[j];
        return Math.min(1, sum / (to - from) / (190 - k * 25));
      });
      const heights = [...bands.slice(1).reverse(), ...bands];
      heights.forEach((value, i) => {
        bars[i].style.height = `${Math.round(4 + value * 36)}px`;
      });
      const total = bands.reduce((a, b) => a + b, 0);
      el.style.setProperty("--level", (total / bands.length).toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      reset();
    };
  }, [status, muted, analyser]);
  return (
    <div
      ref={root}
      className={`voice-visual ${status}${muted ? " muted" : ""}`}
      aria-hidden="true"
    >
      <div className="voice-orb">
        {status === "connecting" ? (
          <LoaderCircle size={34} className="spin" />
        ) : muted ? (
          <MicOff size={34} />
        ) : (
          <Mic size={34} />
        )}
      </div>
      <div className="voice-bars">
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    </div>
  );
}
