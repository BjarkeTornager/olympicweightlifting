"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Check,
  ChevronDown,
  Copy,
  Plus,
  Trash2,
  X,
} from "@/components/ui/icons";
import { exerciseName } from "@/lib/domain";
import {
  isValidLoggedSet,
  updatePendingSets,
  wholeKilograms,
} from "@/js/progression.js";
import type { Entry } from "@/lib/model";
import { exerciseLoggingNotes } from "@/lib/exercises";
import { formatSet } from "@/lib/training";
import { Button } from "./ui/button";
import { RestTimer } from "./rest-timer";
import { Technique } from "./technique";

type ChangeEntry = (fn: (entry: Entry) => void) => void;

// Keeps the athlete's partial text (e.g. "12.") while typing; the journal
// value only replaces it when the field is not focused.
function NumericInput({
  label,
  value,
  onChange,
  step = "any",
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  step?: string;
}) {
  const [text, setText] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value ?? ""));
  }, [value]);
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min="0"
      step={step}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

function WorkoutSet({
  set,
  index: i,
  focused = false,
  onChange,
}: {
  set: Entry["sets"][number];
  index: number;
  // The large "current set" form rather than a compact review row.
  focused?: boolean;
  onChange: ChangeEntry;
}) {
  const made = set.result === "success" || Boolean(set.logged);
  return (
    <div
      className={`set-group ${focused ? "focus-set" : ""} ${made ? "logged" : ""} ${set.result === "miss" ? "missed" : ""}`}
    >
      <div className="set-row">
        <span className="set-number">{i + 1}</span>
        <label className="set-weight-field">
          {focused && <span>Weight · kg</span>}
          <NumericInput
            label={`Set ${i + 1} weight in kilograms`}
            value={set.weight}
            onChange={(value) =>
              onChange((e) => updatePendingSets(e, set.id, "weight", value))
            }
          />
        </label>
        <label className="set-reps-field">
          {focused && <span>Reps</span>}
          <NumericInput
            label={`Set ${i + 1} repetitions`}
            value={set.reps}
            step="1"
            onChange={(value) =>
              onChange((e) => updatePendingSets(e, set.id, "reps", value))
            }
          />
        </label>
        <div className="result-buttons">
          <button
            className={made ? "made" : ""}
            aria-label={`Log set ${i + 1} as made`}
            aria-pressed={made}
            onClick={() =>
              onChange((e) => {
                const s = e.sets.find((s) => s.id === set.id)!;
                if (
                  !isValidLoggedSet({ ...s, result: "success", logged: true })
                )
                  throw Error(
                    "Enter a weight and whole repetitions before logging the set.",
                  );
                s.result = "success";
                s.logged = true;
                s.touched = true;
              })
            }
          >
            <Check size={20} />
            {focused && (
              <span>
                {isValidLoggedSet(set) && set.result !== "miss"
                  ? "Made"
                  : "Log set"}
              </span>
            )}
          </button>
          <button
            className={set.result === "miss" ? "miss" : ""}
            aria-label={`Set ${i + 1} missed`}
            aria-pressed={set.result === "miss"}
            onClick={() =>
              onChange((e) => {
                const s = e.sets.find((s) => s.id === set.id)!;
                if (!isValidLoggedSet({ ...s, result: "miss" }))
                  throw Error(
                    "Enter the attempted weight before logging a miss.",
                  );
                s.result = "miss";
                s.logged = false;
                s.touched = true;
              })
            }
          >
            <X size={19} />
            {focused && <span>Miss</span>}
          </button>
        </div>
      </div>
      <details className="set-options">
        <summary>Set options</summary>
        <div className="adjustments">
          {[-5, -2, 2, 5].map((delta) => (
            <button
              key={delta}
              onClick={() =>
                onChange((e) => {
                  const s = e.sets.find((s) => s.id === set.id)!;
                  updatePendingSets(
                    e,
                    set.id,
                    "weight",
                    String(Math.max(0, wholeKilograms(s.weight) + delta)),
                  );
                })
              }
            >
              {delta > 0 ? "+" : ""}
              {delta} kg
              <small>
                {delta > 0 ? "+" : ""}
                {delta / 2} / side
              </small>
            </button>
          ))}
        </div>
        <div className="set-extra">
          <label>
            RPE (optional)
            <NumericInput
              label={`Set ${i + 1} RPE`}
              value={set.rpe}
              step="0.5"
              onChange={(value) =>
                onChange((e) => updatePendingSets(e, set.id, "rpe", value))
              }
            />
          </label>
          <Button
            variant="ghost"
            disabled={i === 0}
            onClick={() =>
              onChange((e) => {
                const prior = e.sets[i - 1];
                updatePendingSets(e, set.id, "weight", String(prior.weight));
                updatePendingSets(e, set.id, "reps", String(prior.reps));
              })
            }
          >
            <Copy size={16} />
            Previous set
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              onChange((e) => {
                e.sets = e.sets.filter((s) => s.id !== set.id);
                e.completed = false;
              })
            }
          >
            <Trash2 size={16} />
            Remove
          </Button>
        </div>
      </details>
    </div>
  );
}

export function WorkoutExercise({
  entry,
  index,
  count,
  previous,
  active,
  reviewingSetId,
  accountId,
  restDuration,
  onRestDurationChange,
  onToggle,
  onReviewingChange,
  onChange,
  onMove,
  onComplete,
  go,
}: {
  entry: Entry;
  index: number;
  // Number of exercises in the workout, for the move buttons.
  count: number;
  // The same exercise in the most recent earlier session.
  previous?: Entry;
  active: boolean;
  reviewingSetId?: string;
  accountId: string;
  restDuration: number;
  onRestDurationChange: (seconds: number) => void;
  onToggle: () => void;
  onReviewingChange: (setId: string | null) => void;
  onChange: ChangeEntry;
  onMove: (direction: -1 | 1) => void;
  onComplete: () => void;
  go: (route: string) => void;
}) {
  // Keep the current row stable while correcting an earlier set. Editing
  // clears that set's result, but must not unmount its input mid-keystroke.
  const reviewedIndex = entry.sets.findIndex(
    (set) => set.id === reviewingSetId,
  );
  const nextSetIndex = Math.max(
    0,
    reviewedIndex >= 0
      ? reviewedIndex
      : entry.sets.findIndex((set) => !isValidLoggedSet(set)),
  );
  const nextSet = entry.sets[nextSetIndex];
  const allRecorded = entry.sets.every(isValidLoggedSet);
  return (
    <article className={`exercise-card ${active ? "expanded" : ""}`}>
      <button
        className="exercise-toggle"
        onClick={onToggle}
        aria-expanded={active}
      >
        <span
          className={`exercise-number ${entry.completed ? "complete" : ""}`}
        >
          {entry.completed ? (
            <Check size={20} />
          ) : (
            String(index + 1).padStart(2, "0")
          )}
        </span>
        <span>
          <strong>{exerciseName(entry.exerciseId)}</strong>
          <small>
            {entry.prescribed.targetSets ?? entry.sets.length} sets ×{" "}
            {entry.prescribed.targetReps ?? entry.prescribed.reps ?? "—"} reps ·{" "}
            {entry.prescribed.targetWeight !== "" &&
            entry.prescribed.targetWeight != null
              ? `${entry.prescribed.targetWeight} kg`
              : "Choose load"}
          </small>
        </span>
        <ChevronDown size={20} />
      </button>
      {active && (
        <div className="exercise-body">
          {nextSet && (
            <>
              <div className="current-set-heading">
                <p className="current-set-label">
                  {allRecorded
                    ? "All sets recorded"
                    : `Set ${nextSetIndex + 1} of ${entry.sets.length}`}
                </p>
                {/* The label above states the position; the dots only add an
                    at-a-glance view of made and missed sets. */}
                <ol className="set-dots" aria-hidden="true">
                  {entry.sets.map((set, i) => (
                    <li
                      key={set.id}
                      data-state={
                        set.result === "miss"
                          ? "miss"
                          : isValidLoggedSet(set)
                            ? "made"
                            : i === nextSetIndex && !allRecorded
                              ? "current"
                              : "open"
                      }
                    />
                  ))}
                </ol>
              </div>
              <WorkoutSet
                key="focused-set"
                set={nextSet}
                index={nextSetIndex}
                focused
                onChange={onChange}
              />
            </>
          )}
          <RestTimer
            key={accountId}
            accountId={accountId}
            duration={restDuration}
            onDurationChange={onRestDurationChange}
          />
          {entry.sets.length > 1 && (
            <details
              className="other-workout-sets"
              onToggle={(event) =>
                onReviewingChange(
                  event.currentTarget.open && nextSet ? nextSet.id : null,
                )
              }
            >
              <summary>
                Review other sets ({entry.sets.length - 1}){" "}
                <ChevronDown size={17} />
              </summary>
              <div className="set-labels">
                <span>SET</span>
                <span>WEIGHT · KG</span>
                <span>REPS</span>
                <span>RESULT</span>
              </div>
              {entry.sets.map((set, i) =>
                i === nextSetIndex ? null : (
                  <WorkoutSet
                    key={set.id}
                    set={set}
                    index={i}
                    onChange={onChange}
                  />
                ),
              )}
            </details>
          )}
          <div className="section-top">
            <Button
              variant="ghost"
              onClick={() =>
                onChange((e) => {
                  const last = e.sets.at(-1);
                  e.sets.push({
                    id: crypto.randomUUID(),
                    weight: String(last?.weight ?? ""),
                    reps: String(last?.reps ?? 1),
                    rpe: "",
                    result: "",
                    touched: false,
                  });
                  e.completed = false;
                })
              }
            >
              <Plus size={17} />
              Add set
            </Button>
            <Technique exerciseId={entry.exerciseId} />
          </div>
          <details className="exercise-help">
            <summary>
              Exercise details <ChevronDown size={17} />
            </summary>
            <div className="button-row">
              <Button variant="ghost" onClick={() => go("coach/lifting/video")}>
                Get technique feedback
              </Button>
            </div>
            <div className="button-row exercise-order">
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  variant="ghost"
                  disabled={index + direction < 0 || index + direction >= count}
                  aria-label={`Move ${exerciseName(entry.exerciseId)} ${direction < 0 ? "up" : "down"}`}
                  onClick={() => onMove(direction)}
                >
                  {direction < 0 ? (
                    <ArrowUp size={17} />
                  ) : (
                    <ArrowDown size={17} />
                  )}
                  Move {direction < 0 ? "up" : "down"}
                </Button>
              ))}
            </div>
            <p className="muted">{entry.prescribed.notes}</p>
            {previous && (
              <p className="previous">
                Last session:{" "}
                {previous.sets
                  .filter(isValidLoggedSet)
                  .map((s) => formatSet(s.weight, s.reps))
                  .join(" · ") || "No logged sets"}
              </p>
            )}
            <p className="exercise-logging-note">
              {exerciseLoggingNotes(entry.exerciseId)}
            </p>
          </details>
          <details className="notes">
            <summary>Notes & coach cue</summary>
            <div className="form-grid">
              <label>
                Your notes
                <textarea
                  value={entry.athleteNotes}
                  onChange={(e) =>
                    onChange((item) => {
                      item.athleteNotes = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                Coach cue
                <textarea
                  value={entry.coachCue}
                  onChange={(e) =>
                    onChange((item) => {
                      item.coachCue = e.target.value;
                    })
                  }
                />
              </label>
            </div>
          </details>
          <Button variant="secondary" className="full" onClick={onComplete}>
            Complete {exerciseName(entry.exerciseId)}
          </Button>
        </div>
      )}
    </article>
  );
}
