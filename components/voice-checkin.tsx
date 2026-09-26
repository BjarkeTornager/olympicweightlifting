"use client";
import { useEffect, useRef } from "react";
import { useVoiceCheckin, type SaveResult } from "@/lib/use-voice-checkin";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Check, LoaderCircle, Mic, MicOff, PhoneOff } from "./ui/icons";

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
  headers,
  onSave,
  onReview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headers: () => Record<string, string>;
  onSave: (report: string) => Promise<SaveResult>;
  onReview: () => void;
}) {
  const voice = useVoiceCheckin({ headers, onSave });
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
      <div className={`voice-orb ${voice.status}`} aria-hidden="true">
        {voice.status === "connecting" ? (
          <LoaderCircle size={34} className="spin" />
        ) : voice.muted ? (
          <MicOff size={34} />
        ) : (
          <Mic size={34} />
        )}
      </div>
      <p className="voice-status" role="status">
        {voice.status === "failed"
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
                <strong>{save.topic}</strong>{" "}
                {save.state === "failed"
                  ? `not saved: ${save.detail}`
                  : save.state === "saving"
                    ? "saving…"
                    : "saved"}
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
