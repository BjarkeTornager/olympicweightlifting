"use client";
import { useState } from "react";
import { Check, ChevronDown, Dumbbell, Plus } from "@/components/ui/icons";
import { today, createEntry, finishWorkout, replanDraft } from "@/lib/domain";
import { isValidLoggedSet } from "@/js/progression.js";
import type { Entry, JournalState, ProgramExercise } from "@/lib/model";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { ExercisePicker } from "./exercise-picker";
import { ActivityForm } from "./cardio";
import { ActivityPhotoUpload } from "./activity-photo-upload";
import { WorkoutExercise } from "./workout-exercise";
import {
  cardioActivitySchema,
  cardioLabels,
  cardioTitle,
  formatDuration,
  type CardioActivity,
} from "@/lib/cardio";

// New personal bests set by the just-finished session, for confirmation.
function personalBests(
  completed: JournalState,
  sessionId: string,
): [string, number][] {
  const session = completed.sessions.find((s) => s.id === sessionId);
  if (!session) return [];
  const found = new Map<string, number>();
  for (const entry of session.exercises)
    for (const set of entry.sets)
      if (
        isValidLoggedSet(set) &&
        set.result !== "miss" &&
        Number(set.weight) > (completed.prs[entry.exerciseId] ?? 0)
      )
        found.set(
          entry.exerciseId,
          Math.max(found.get(entry.exerciseId) ?? 0, Number(set.weight)),
        );
  return [...found];
}
export function ActiveWorkout({
  state,
  update,
  go,
  notify,
  accountId,
  onFinished,
}: {
  accountId: string;
  state: JournalState;
  update: (fn: (state: JournalState) => JournalState | void) => Promise<void>;
  go: (route: string) => void;
  notify: (message: string) => void;
  onFinished: (prs: [string, number][]) => void;
}) {
  const draft = state.activeWorkout!;
  const [expanded, setExpanded] = useState(
      draft.activeExerciseId ??
        draft.exercises.find((entry) =>
          entry.sets.some((set) => !isValidLoggedSet(set)),
        )?.id ??
        draft.exercises[0]?.id ??
        "",
    ),
    [reviewingSets, setReviewingSets] = useState<Record<string, string>>({}),
    [restDuration, setRestDuration] = useState(
      state.preferences.restSeconds ?? 90,
    ),
    [finish, setFinish] = useState(false),
    [discard, setDiscard] = useState(false),
    [add, setAdd] = useState(""),
    [loggingActivity, setLoggingActivity] = useState<CardioActivity | null>(
      null,
    );
  const activityChoice = cardioActivitySchema.safeParse(
    add.startsWith("activity:") ? add.slice("activity:".length) : undefined,
  );
  const selectedActivity = activityChoice.success ? activityChoice.data : null;
  const dayActivities = state.cardio.sessions.filter(
    (s) => s.date === draft.date,
  );
  const save = (fn: (s: JournalState) => void) =>
    void update(fn).catch((e) => notify(e.message));
  const changeEntry = (id: string, fn: (e: Entry) => void) =>
    save((s) => {
      const entry = s.activeWorkout?.exercises.find((e) => e.id === id);
      if (entry) fn(entry);
    });
  const logged = draft.exercises.reduce(
      (n, e) => n + e.sets.filter(isValidLoggedSet).length,
      0,
    ),
    total = draft.exercises.reduce((n, e) => n + e.sets.length, 0);
  const complete = async () => {
    try {
      let found: [string, number][] = [];
      await update((current) => {
        const completed = finishWorkout(current);
        found = personalBests(completed, draft.editingSessionId ?? draft.id);
        return completed;
      });
      setFinish(false);
      onFinished(found);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not finish workout.");
      setFinish(false);
    }
  };
  return (
    <section className="focused-workout" aria-label="Ongoing workout">
      <div className="page-heading compact workout-heading">
        <div>
          <h1>{draft.title}</h1>
          <p className="lead">
            {logged} of {total} sets logged · {draft.date}
          </p>
        </div>
        <Button
          variant="ghost"
          aria-label="Finish workout"
          onClick={() => setFinish(true)}
        >
          Finish <Check size={18} />
        </Button>
      </div>
      <div className="session-progress">
        <span style={{ width: `${total ? (logged / total) * 100 : 0}%` }} />
      </div>
      <div className="exercise-stack">
        {draft.exercises.map((entry, index) => (
          <WorkoutExercise
            key={entry.id}
            entry={entry}
            index={index}
            count={draft.exercises.length}
            previous={[...state.sessions]
              .filter(
                (w) => w.id !== draft.editingSessionId && w.date <= draft.date,
              )
              .sort((a, b) => b.date.localeCompare(a.date))
              .flatMap((w) => w.exercises)
              .find((e) => e.exerciseId === entry.exerciseId)}
            active={expanded === entry.id}
            reviewingSetId={reviewingSets[entry.id]}
            accountId={accountId}
            restDuration={restDuration}
            onRestDurationChange={setRestDuration}
            onToggle={() => {
              setReviewingSets({});
              setExpanded(expanded === entry.id ? "" : entry.id);
            }}
            onReviewingChange={(setId) =>
              setReviewingSets((current) => {
                const next = { ...current };
                if (setId) next[entry.id] = setId;
                else delete next[entry.id];
                return next;
              })
            }
            onChange={(fn) => changeEntry(entry.id, fn)}
            onMove={(direction) =>
              save((s) => {
                const entries = s.activeWorkout!.exercises;
                const from = entries.findIndex((e) => e.id === entry.id),
                  to = from + direction;
                if (from >= 0 && to >= 0 && to < entries.length)
                  [entries[from], entries[to]] = [entries[to], entries[from]];
              })
            }
            onComplete={() => {
              if (!entry.sets.length || !entry.sets.every(isValidLoggedSet)) {
                notify(
                  "Log every remaining set before completing this exercise, or finish a partial workout.",
                );
                return;
              }
              changeEntry(entry.id, (e) => {
                e.completed = true;
              });
              setReviewingSets({});
              setExpanded(draft.exercises[index + 1]?.id ?? entry.id);
            }}
            go={go}
          />
        ))}
      </div>
      <details className="panel session-details">
        <summary>
          Workout details <ChevronDown size={17} />
        </summary>
        <div className="form-grid">
          <label>
            Training date
            <input
              type="date"
              value={draft.date}
              onChange={(e) =>
                save((s) => {
                  if (e.target.value && s.activeWorkout) {
                    s.activeWorkout.date = e.target.value;
                    replanDraft(s);
                  }
                })
              }
            />
          </label>
          <label>
            Recovery today
            <select
              value={draft.recovery}
              onChange={(e) =>
                save((s) => {
                  s.activeWorkout!.recovery = e.target.value as
                    "auto" | "limited";
                  replanDraft(s);
                })
              }
            >
              <option value="auto">Automatic · follow programme</option>
              <option value="limited">Limited · repeat previous loads</option>
            </select>
          </label>
        </div>
        <div className="button-row">
          <Button asChild variant="secondary">
            <a href="#workout/gym_accessories">Gym Accessories</a>
          </Button>
          <Button asChild variant="ghost">
            <a href="#workout/choose">All programmes</a>
          </Button>
          <Button variant="danger" onClick={() => setDiscard(true)}>
            Discard draft
          </Button>
        </div>
        <ActivityPhotoUpload accountId={accountId} go={go} />
      </details>
      <div className="panel add-exercise">
        <ExercisePicker
          label="Add an exercise or activity"
          value={add}
          onChange={setAdd}
          includeActivities
        />
        <Button
          variant="secondary"
          disabled={!add}
          onClick={() => {
            if (selectedActivity) {
              setLoggingActivity(selectedActivity);
              return;
            }
            save((s) => {
              const ex: ProgramExercise = {
                exerciseId: add,
                sets: 3,
                reps: "5",
                defaultReps: 5,
                initialWeight: "",
                notes: "Choose a comfortable working weight.",
                priority: 99,
                recommendation: "Manual",
                videoRef: add,
              };
              const entry = createEntry(
                ex,
                s,
                s.activeWorkout!.programDayId,
                s.activeWorkout!.date,
              );
              s.activeWorkout!.exercises.push(entry);
              setReviewingSets({});
              setExpanded(entry.id);
            });
          }}
        >
          <Plus size={18} />
          {selectedActivity
            ? `Log ${cardioLabels[selectedActivity]}`
            : "Add exercise"}
        </Button>
      </div>
      {dayActivities.length > 0 && (
        <section className="panel" aria-label="Movement on this training day">
          <h2>Movement · {draft.date}</h2>
          <ul className="cardio-breakdown">
            {dayActivities.map((activity) => (
              <li key={activity.id}>
                <strong>{cardioTitle(activity)}</strong>
                <span>
                  {formatDuration(activity.durationSeconds)}
                  {activity.distanceKm == null
                    ? ""
                    : ` · ${activity.distanceKm} km`}
                </span>
              </li>
            ))}
          </ul>
          <a className="text-link" href="#cardio">
            View activity history
          </a>
        </section>
      )}
      <Dialog
        open={loggingActivity !== null}
        onOpenChange={(open) => {
          if (!open) setLoggingActivity(null);
        }}
        title={
          loggingActivity
            ? `Log ${cardioLabels[loggingActivity]}`
            : "Log activity"
        }
      >
        {loggingActivity && (
          <ActivityForm
            journal={{ update }}
            entry={null}
            initialActivity={loggingActivity}
            initialDate={draft.date > today() ? today() : draft.date}
            onClose={() => setLoggingActivity(null)}
            onSaved={(activity) => {
              setAdd("");
              notify(
                `${cardioLabels[activity]} saved to your activity history.`,
              );
            }}
          />
        )}
      </Dialog>
      <details className="panel notes">
        <summary>Session notes</summary>
        <div className="form-grid">
          <label>
            Athlete notes
            <textarea
              value={draft.athleteNotes}
              onChange={(e) =>
                save((s) => {
                  s.activeWorkout!.athleteNotes = e.target.value;
                })
              }
            />
          </label>
          <label>
            Overall coach notes
            <textarea
              value={draft.coachNotes}
              onChange={(e) =>
                save((s) => {
                  s.activeWorkout!.coachNotes = e.target.value;
                })
              }
            />
          </label>
        </div>
      </details>
      <div className="workout-dock">
        <span>
          <Dumbbell size={18} />
          <strong>{logged}</strong> / {total} sets logged
        </span>
        <Button onClick={() => setFinish(true)}>
          Finish workout <Check size={18} />
        </Button>
      </div>
      <Dialog
        open={finish}
        onOpenChange={setFinish}
        title="Finish your workout?"
        description={`You've logged ${logged} of ${total} sets. Finishing marks this session complete. Unlogged sets stay unrecorded; a partial session will not unlock a load increase.`}
      >
        <div className="button-row">
          <Button onClick={() => void complete()}>Finish workout</Button>
          <Button variant="secondary" onClick={() => setFinish(false)}>
            Keep training
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={discard}
        onOpenChange={setDiscard}
        title="Discard this draft?"
        description="This removes the unfinished workout from your journal. Completed training history stays saved."
      >
        <div className="button-row">
          <Button
            variant="danger"
            onClick={async () => {
              await update((s) => {
                s.activeWorkout = null;
              });
              setDiscard(false);
              go("workout/choose");
            }}
          >
            Discard draft
          </Button>
          <Button variant="secondary" onClick={() => setDiscard(false)}>
            Keep training
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
