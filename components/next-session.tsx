"use client";
import { useState } from "react";
import type { JournalState } from "@/lib/model";
import { nextTraining, startNextTraining } from "@/lib/next-training";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";

export function NextSession({
  state,
  update,
  go,
}: {
  state: JournalState;
  update: JournalController["update"];
  go: (route: string) => void;
}) {
  const next = nextTraining(state);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="training-quick-start" aria-label="Suggested session">
      <h2>{state.activeWorkout?.title ?? next.title}</h2>
      <p className="muted">
        {state.activeWorkout
          ? `Ready to resume your saved workout from ${state.activeWorkout.date}`
          : `Next in ${next.programName}, day ${next.position} of ${next.count}`}
      </p>
      {!state.activeWorkout && (
        <p className="fine-print">
          {next.previousDate
            ? `Follows your recorded session on ${next.previousDate}. Train when it suits you.`
            : "Start at the beginning, or choose another session."}
        </p>
      )}
      <div className="button-row">
        <Button
          disabled={busy}
          onClick={async () => {
            if (state.activeWorkout) return go("workout");
            if (!next.canStart) return go("workout/choose");
            setBusy(true);
            setError("");
            try {
              await update((s) => startNextTraining(s));
              go("workout");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not start. Please retry.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {state.activeWorkout
            ? "Resume workout"
            : next.canStart
              ? "Start workout"
              : "View activity / recovery day"}
        </Button>
        <Button variant="ghost" onClick={() => go("workout/choose")}>
          Choose another
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
