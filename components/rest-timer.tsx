"use client";
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, Timer } from "@/components/ui/icons";
import { Button } from "./ui/button";
// `full` is the duration an idle clock was set to, so an untouched timer
// can start from the next exercise's rest instead of the last one's.
type Clock = { endsAt: number | null; remaining: number; full?: number };
const durationLabel = (seconds: number) =>
  seconds < 60 || seconds % 30 ? `${seconds} s` : `${seconds / 60} min`;
export function RestTimer({
  accountId,
  duration = 90,
  onDurationChange,
}: {
  accountId: string;
  duration?: number;
  onDurationChange?: (seconds: number) => void;
}) {
  const [clock, setClock] = useState<Clock>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`lift-rest:${accountId}`) ?? "null",
      );
      if (
        saved &&
        (saved.endsAt === null || Number.isFinite(saved.endsAt)) &&
        Number.isFinite(saved.remaining) &&
        saved.remaining >= 0 &&
        saved.remaining <= 1800
      )
        return saved.endsAt === null && saved.remaining === saved.full
          ? { endsAt: null, remaining: duration, full: duration }
          : saved;
    } catch {}
    return { endsAt: null, remaining: duration, full: duration };
  });
  const [selected, setSelected] = useState(duration);
  const choices = [...new Set([60, 90, 120, 180, 300, selected])].sort(
    (a, b) => a - b,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [accountId]);
  useEffect(() => {
    try {
      localStorage.setItem(`lift-rest:${accountId}`, JSON.stringify(clock));
    } catch {}
  }, [clock, accountId]);
  const remaining =
    clock.endsAt === null
      ? clock.remaining
      : Math.max(0, Math.ceil((clock.endsAt - now) / 1000));
  const running = clock.endsAt !== null && remaining > 0;
  return (
    <section className="rest-timer" aria-label="Rest timer">
      <Timer size={20} />
      <div>
        <strong>Rest</strong>
        <span className="timer-digits">
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </span>
      </div>
      <label>
        <span className="sr-only">Rest duration</span>
        <select
          aria-label="Rest duration"
          value={selected}
          onChange={(e) => {
            const seconds = Number(e.target.value);
            setSelected(seconds);
            onDurationChange?.(seconds);
            setClock({ endsAt: null, remaining: seconds, full: seconds });
          }}
        >
          {choices.map((s) => (
            <option key={s} value={s}>
              {durationLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="secondary"
        onClick={() => {
          const at = Date.now();
          setNow(at);
          setClock(
            running
              ? { endsAt: null, remaining }
              : {
                  endsAt: at + (remaining || selected) * 1000,
                  remaining: remaining || selected,
                },
          );
        }}
      >
        {running ? <Pause size={16} /> : <Play size={16} />}
        {running ? "Pause" : "Start rest"}
      </Button>
      <Button
        variant="ghost"
        aria-label="Reset rest timer"
        onClick={() =>
          setClock({ endsAt: null, remaining: selected, full: selected })
        }
      >
        <RotateCcw size={18} />
      </Button>
      <span role="status" className="timer-status">
        {remaining === 0 && clock.endsAt ? "Rest complete" : ""}
      </span>
    </section>
  );
}
