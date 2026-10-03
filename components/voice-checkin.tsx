"use client";
import { Fragment, useEffect, useRef } from "react";
import { useVoiceCheckin, type VoiceStatus } from "@/lib/use-voice-checkin";
import { updateAppNow } from "@/lib/use-service-worker";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { AguiVisuals } from "./agui-components";
import { Camera, Check, LoaderCircle, Mic, MicOff, PhoneOff } from "./ui/icons";

const statusText = {
  idle: "Coach asks what’s missing for today. Just answer out loud.",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Coach is speaking",
  reconnecting: "Reconnecting… the conversation carries on",
  paused: "Paused while you were away",
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
  purpose = "checkin",
}: {
  purpose?: "checkin" | "goals";
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
  const inCall =
    live || ["connecting", "reconnecting", "paused"].includes(voice.status);
  const receipts = voice.lines.filter((l) => l.role === "save");
  const saved = receipts.filter((r) => r.state === "saved").length;
  const failed = receipts.filter((r) => r.state === "failed").length;
  const cards = voice.lines.filter((l) => l.role === "card").length;
  const summary = [
    receipts.length ? `${saved} saved` : "",
    failed ? `${failed} not saved yet` : "",
    cards ? `${cards} ${cards === 1 ? "card" : "cards"}` : "",
  ].filter(Boolean);
  const transcript = useRef<HTMLDivElement>(null);
  // Whether the transcript follows the latest line: until the athlete
  // scrolls up, or a card is being read.
  const following = useRef(true);
  // The card last scrolled to: each is shown from its top once.
  const shownCard = useRef<string | undefined>(undefined);
  useEffect(() => {
    const box = transcript.current;
    if (!box) return;
    // A new card is shown from its top while the coach sums it up, as on
    // the iPhone; otherwise the latest line, unless the athlete is reading
    // further up.
    const card = voice.lines.findLast((l) => l.role === "card");
    if (card && card.id !== shownCard.current) {
      shownCard.current = card.id;
      const top = box
        .querySelector(`[data-card="${card.id}"]`)
        ?.getBoundingClientRect().top;
      if (top !== undefined) {
        box.scrollTo({
          top: box.scrollTop + top - box.getBoundingClientRect().top - 12,
        });
        return;
      }
    }
    if (following.current) box.scrollTo({ top: box.scrollHeight });
  }, [voice.lines]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) voice.stop();
        onOpenChange(next);
      }}
      title={purpose === "goals" ? "Set up your goals" : "Check in by voice"}
      description={
        purpose === "goals"
          ? "Tell Coach about yourself and your goal weight. It works out your daily calories and training."
          : "A short spoken check-in about today’s training, food and sleep."
      }
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
        <div
          className="voice-transcript"
          ref={transcript}
          aria-live="polite"
          onScroll={(e) => {
            const box = e.currentTarget;
            following.current =
              box.scrollHeight - box.scrollTop - box.clientHeight < 40;
          }}
        >
          {voice.lines.map((line, i) =>
            line.role === "card" ? (
              <Fragment key={line.id}>
                {/* Announced in a few words; the card itself is read when
                    the athlete moves to it, never over the coach. */}
                <span className="sr-only">
                  Card shown: {line.visual.content.title}
                </span>
                <div className="voice-card" data-card={line.id} aria-live="off">
                  <AguiVisuals visuals={[line.visual]} accountId={accountId} />
                </div>
              </Fragment>
            ) : line.role === "save" ? (
              <p key={line.id} className={`voice-receipt ${line.state}`}>
                {line.state === "saving" ? (
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                ) : line.state === "saved" ? (
                  <Check size={14} aria-hidden="true" />
                ) : null}
                {line.label}{" "}
                {line.state === "saving"
                  ? "saving…"
                  : line.state === "saved"
                    ? "saved"
                    : "not saved yet"}
              </p>
            ) : (
              <p key={i} className={line.role}>
                {line.text}
              </p>
            ),
          )}
        </div>
      )}
      {summary.length > 0 && (
        <p className="voice-summary">{summary.join(" · ")}</p>
      )}
      <div className="voice-actions">
        {voice.status === "paused" ? (
          <>
            <Button onClick={voice.resume}>
              <Mic size={18} /> Continue
            </Button>
            <Button variant="danger" onClick={voice.stop}>
              <PhoneOff size={18} /> End
            </Button>
          </>
        ) : inCall ? (
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
            {voice.outdated ? (
              <Button onClick={() => void updateAppNow()}>Update now</Button>
            ) : (
              <Button onClick={() => voice.start(purpose)}>
                <Mic size={18} />
                {voice.status === "idle" ? "Start talking" : "Talk again"}
              </Button>
            )}
            {(receipts.length > 0 || cards > 0) && (
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
