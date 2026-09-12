"use client";
import { useState } from "react";
import type { JournalState } from "@/lib/model";
import { exerciseName } from "@/lib/domain";
import { formatSet } from "@/lib/training";
import {
  mergeWorkoutSessions,
  type WorkoutStatus,
} from "@/lib/workout-continuity";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function CombineSessions({
  state,
  update,
  go,
  notify,
}: {
  state: JournalState;
  update: JournalController["update"];
  go: (route: string) => void;
  notify: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [completion, setCompletion] = useState<WorkoutStatus>("completed");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chosenDate = state.sessions.find((s) => s.id === ids[0])?.date;
  const candidates = [...state.sessions].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  let preview: ReturnType<typeof mergeWorkoutSessions> | null = null;
  let previewError = "";
  if (ids.length >= 2) {
    try {
      preview = mergeWorkoutSessions(state, ids, name, completion);
    } catch (e) {
      previewError =
        e instanceof Error ? e.message : "Check the selected sessions.";
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        disabled={state.sessions.length < 2}
        onClick={() => {
          setIds([]);
          setName("");
          setCompletion("completed");
          setError("");
          setOpen(true);
        }}
      >
        Combine sessions
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Combine split workout entries"
        description="Choose entries from the same workout and date. Review the combined result before saving. Every set and note is kept, including repeated sets."
      >
        <div className="combine-session-picker">
          {candidates.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={ids.includes(s.id)}
                disabled={
                  Boolean(chosenDate && chosenDate !== s.date) ||
                  (!ids.includes(s.id) && ids.length >= 10)
                }
                onChange={(e) => {
                  setError("");
                  if (e.target.checked) {
                    setIds([...ids, s.id]);
                    if (!ids.length) setName(s.title);
                  } else setIds(ids.filter((id) => id !== s.id));
                }}
              />
              <span>
                <strong>{s.title}</strong>
                <small>
                  {s.date} ·{" "}
                  {s.exercises.reduce((n, e) => n + e.sets.length, 0)} sets
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="form-grid">
          <label>
            Workout name
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            After combining
            <select
              value={completion}
              onChange={(e) => setCompletion(e.target.value as WorkoutStatus)}
            >
              <option value="completed">Completed — keep in History</option>
              <option value="ongoing">Ongoing — continue in Train</option>
            </select>
          </label>
        </div>
        {preview && (
          <div className="combined-workout-preview">
            <h3>{preview.workout.title}</h3>
            <p>
              {ids.length} entries → 1 {completion} workout ·{" "}
              {preview.workout.exercises.reduce((n, e) => n + e.sets.length, 0)}{" "}
              sets
            </p>
            {preview.workout.exercises.map((e) => (
              <div key={e.id}>
                <strong>{exerciseName(e.exerciseId)}</strong>
                <div className="set-chips">
                  {e.sets.map((s) => (
                    <span key={s.id}>
                      {formatSet(s.weight, s.reps)}
                      {s.result === "miss" ? " · miss" : ""}
                      {s.rpe ? ` · RPE ${s.rpe}` : ""}
                    </span>
                  ))}
                </div>
                {e.athleteNotes && <p>{e.athleteNotes}</p>}
                {e.coachCue && <p>{e.coachCue}</p>}
              </div>
            ))}
            {preview.workout.athleteNotes && (
              <p className="preserved-workout-notes">
                {preview.workout.athleteNotes}
              </p>
            )}
            {preview.workout.coachNotes && (
              <p className="preserved-workout-notes">
                {preview.workout.coachNotes}
              </p>
            )}
          </div>
        )}
        {(error || previewError) && <p role="alert">{error || previewError}</p>}
        <p className="fine-print">
          The selected history entries will be replaced by this one workout. Use
          Undo last change to restore them if needed.
        </p>
        <div className="button-row">
          <Button
            disabled={!preview || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              const originals = ids.map((id) =>
                state.sessions.find((s) => s.id === id),
              );
              try {
                await update((current) => {
                  if (
                    JSON.stringify(
                      ids.map((id) =>
                        current.sessions.find((s) => s.id === id),
                      ),
                    ) !== JSON.stringify(originals)
                  )
                    throw Error(
                      "A selected session changed. Review the updated entries before combining.",
                    );
                  return mergeWorkoutSessions(current, ids, name, completion)
                    .state;
                });
                setOpen(false);
                notify(
                  `Combined ${ids.length} entries into one ${completion} workout. Undo last change restores the original entries.`,
                );
                go(completion === "ongoing" ? "workout" : "history");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not combine sessions.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Combining…" : `Combine ${ids.length} sessions`}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </>
  );
}
