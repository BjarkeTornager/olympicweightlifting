"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Dumbbell,
  Plus,
  Play,
  Trash2,
  X,
} from "lucide-react";
import {
  days,
  today,
  program,
  EXERCISES,
  exerciseName,
  createEntry,
  finishWorkout,
  replanDraft,
} from "@/lib/domain";
import {
  isValidLoggedSet,
  planProgramDay,
  updatePendingSets,
  wholeKilograms,
} from "@/js/progression.js";
import type { Entry, JournalState, ProgramExercise } from "@/lib/model";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
type Update = (
  fn: (state: JournalState) => JournalState | void,
) => Promise<void>;
type Props = {
  state: JournalState;
  update: Update;
  route: string;
  go: (route: string) => void;
  onStart: (id: string, date?: string) => Promise<void>;
  notify: (message: string) => void;
};
export function NumericInput({
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
export function Technique({ exerciseId }: { exerciseId: string }) {
  const [open, setOpen] = useState(false);
  const ex = EXERCISES.find((e) => e.id === exerciseId);
  if (!ex?.videoId)
    return (
      <span className="fine-print">
        Choose an exercise variation with your coach.
      </span>
    );
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Play size={16} />
        Technique
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={ex.name}
        description={ex.purpose}
      >
        <div className="video-frame">
          {open && (
            <iframe
              title={`${ex.name} technique demonstration`}
              src={`https://www.youtube-nocookie.com/embed/${ex.videoId}`}
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
        <ul className="cues">
          {ex.cues.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="button-row">
          <Button asChild variant="secondary">
            <a
              href={`https://www.youtube.com/watch?v=${ex.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open YouTube <ArrowUpRight size={16} />
            </a>
          </Button>
          {ex.sourceUrl && (
            <a
              className="text-link"
              href={ex.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Exercise notes <ArrowUpRight size={16} />
            </a>
          )}
        </div>
      </Dialog>
    </>
  );
}
export function Workouts(props: Props) {
  const { state, route, onStart, go } = props;
  const [date, setDate] = useState(today),
    [filter, setFilter] = useState("all");
  const parameter = route.split("/")[1];
  const day = days.find((d) => d.id === parameter);
  if (state.activeWorkout && !parameter)
    return <ActiveWorkout key={state.activeWorkout.id} {...props} />;
  if (day) {
    const plan = planProgramDay(day, {
      sessions: state.sessions,
      programId: program.id,
      date,
    });
    return (
      <>
        <button
          className="text-link back-link"
          onClick={() => go("workout/choose")}
        >
          <ArrowLeft size={17} />
          All programmes
        </button>
        <div className="page-heading compact">
          <div>
            <div className="eyebrow">
              {day.id === "saturday" ? "WITH YOUR COACH" : "ON YOUR OWN"} ·{" "}
              {day.exercises.length} EXERCISES
            </div>
            <h1>{day.title}</h1>
            <p className="lead">{day.focus}</p>
          </div>
        </div>
        {state.activeWorkout ? (
          <div className="notice">
            <div>
              <strong>{state.activeWorkout.title} is in progress.</strong>
              <p>
                View this programme freely. Finish or discard your saved workout
                before starting another.
              </p>
            </div>
            <Button onClick={() => go("workout")}>Resume workout</Button>
          </div>
        ) : (
          <div className="picker-bar">
            <label>
              Training date
              <input
                aria-label="Training date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || today())}
              />
            </label>
            <Button onClick={() => void onStart(day.id, date)}>
              Start this programme <ArrowRight size={18} />
            </Button>
          </div>
        )}
        {day.sessionPrompt && (
          <details className="panel guidance">
            <summary>Session guidance</summary>
            <p>{day.sessionPrompt}</p>
          </details>
        )}
        <div className="program-exercises">
          {day.exercises.map((ex, i) => {
            const target = plan.exercises[i];
            return (
              <article className="panel prescription" key={ex.exerciseId}>
                <div className="prescription-heading">
                  <span className="program-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2>{exerciseName(ex.exerciseId)}</h2>
                    <p>
                      {target.sets} sets × {target.reps} reps
                    </p>
                  </div>
                  <strong className="prescription-load">
                    {target.weight !== "" && target.weight != null
                      ? `${target.weight} kg`
                      : "Choose load"}
                  </strong>
                </div>
                <p className="muted">{ex.notes}</p>
                <div className="section-top">
                  <span
                    className={`pill ${target.status === "increase" ? "success" : ""}`}
                  >
                    {target.status === "increase"
                      ? `+${target.step} kg next time`
                      : target.status === "manual"
                        ? "Manual load"
                        : target.status === "choose"
                          ? "Choose your starting load"
                          : "Your next prescription"}
                  </span>
                  <Technique exerciseId={ex.videoRef ?? ex.exerciseId} />
                </div>
                <details className="plan-reason">
                  <summary>Why this load?</summary>
                  <p>{target.reason}</p>
                  {plan.trainedToday && (
                    <p>
                      Available from {plan.availableFrom}. Repeating today uses
                      today’s prescription.
                    </p>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR TRAINING</div>
          <h1>Choose your session.</h1>
          <p className="lead">
            Your programme fits your day. Train any session on any date.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void onStart("open", date)}>
          <Plus size={18} />
          Open workout
        </Button>
      </div>
      {state.activeWorkout && (
        <div className="notice">
          <span>
            Saved workout: <strong>{state.activeWorkout.title}</strong>
          </span>
          <Button onClick={() => go("workout")}>Resume workout</Button>
        </div>
      )}
      <div className="picker-bar">
        <label>
          Training date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || today())}
          />
        </label>
        <Button variant="ghost" onClick={() => setDate(today())}>
          Today
        </Button>
        <div className="segmented" aria-label="Programme filter">
          {[
            ["all", "All programmes"],
            ["solo", "On my own"],
            ["coach", "With my coach"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="picker-grid">
        {days
          .filter(
            (d) =>
              filter === "all" ||
              (filter === "coach" ? d.id === "saturday" : d.id !== "saturday"),
          )
          .map((d, i) => {
            const plan = planProgramDay(d, {
              sessions: state.sessions,
              programId: program.id,
              date,
            });
            return (
              <article className="panel picker-card" key={d.id}>
                <div className="section-top">
                  <span className="program-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="pill">
                    {d.id === "saturday"
                      ? "COACHED"
                      : d.id === "gym_accessories"
                        ? "ANY DAY"
                        : "SOLO"}
                  </span>
                </div>
                <h2>{d.title}</h2>
                <p className="muted">{d.focus}</p>
                <details>
                  <summary>Preview {d.exercises.length} exercises</summary>
                  {plan.exercises.map((e) => (
                    <div className="load-row" key={e.exerciseId}>
                      <span>{exerciseName(e.exerciseId)}</span>
                      <strong>
                        {e.weight !== "" && e.weight != null
                          ? `${e.weight} kg`
                          : "Manual"}
                      </strong>
                    </div>
                  ))}
                </details>
                <div className="button-row">
                  <Button
                    onClick={() =>
                      state.activeWorkout
                        ? go(`workout/${d.id}`)
                        : void onStart(d.id, date)
                    }
                  >
                    {state.activeWorkout ? "View programme" : "Start session"}
                    <ArrowUpRight size={18} />
                  </Button>
                  {!state.activeWorkout && (
                    <Button
                      variant="ghost"
                      onClick={() => go(`workout/${d.id}`)}
                    >
                      Details
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
    </>
  );
}
function ActiveWorkout({ state, update, go, notify }: Props) {
  const draft = state.activeWorkout!;
  const [expanded, setExpanded] = useState(
      draft.activeExerciseId ?? draft.exercises[0]?.id ?? "",
    ),
    [finish, setFinish] = useState(false),
    [discard, setDiscard] = useState(false),
    [add, setAdd] = useState(EXERCISES[0].id),
    [candidates, setCandidates] = useState<[string, number][]>([]);
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
  const saveFinished = async (usePrs: boolean) => {
    try {
      await update((current) => {
        const completed = finishWorkout(current);
        if (usePrs)
          for (const [id, weight] of candidates) completed.prs[id] = weight;
        return completed;
      });
      setFinish(false);
      setCandidates([]);
      go("history");
      notify("Workout saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not finish workout.");
    }
  };
  const complete = async () => {
    try {
      const completed = finishWorkout(state);
      const prs = new Map<string, number>();
      const session = completed.sessions.find(
        (s) => s.id === (draft.editingSessionId ?? draft.id),
      )!;
      for (const e of session.exercises)
        for (const s of e.sets)
          if (
            isValidLoggedSet(s) &&
            s.result !== "miss" &&
            Number(s.weight) > (completed.prs[e.exerciseId] ?? 0)
          )
            prs.set(
              e.exerciseId,
              Math.max(prs.get(e.exerciseId) ?? 0, Number(s.weight)),
            );
      if (prs.size) {
        setFinish(false);
        setCandidates([...prs]);
      } else await saveFinished(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not finish workout.");
      setFinish(false);
    }
  };
  return (
    <>
      <div className="page-heading compact workout-heading">
        <div>
          <div className="eyebrow">ON THE PLATFORM</div>
          <h1>{draft.title}</h1>
          <p className="lead">
            {logged} of {total} sets logged · {draft.date}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setFinish(true)}>
          Finish workout <Check size={18} />
        </Button>
      </div>
      <div className="session-progress">
        <span style={{ width: `${total ? (logged / total) * 100 : 0}%` }} />
      </div>
      <details className="panel session-details">
        <summary>
          Session details & programmes <ChevronDown size={17} />
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
      </details>
      <div className="exercise-stack">
        {draft.exercises.map((entry, index) => {
          const active = expanded === entry.id;
          const previous = [...state.sessions]
            .filter(
              (w) => w.id !== draft.editingSessionId && w.date <= draft.date,
            )
            .sort((a, b) => b.date.localeCompare(a.date))
            .flatMap((w) => w.exercises)
            .find((e) => e.exerciseId === entry.exerciseId);
          return (
            <article
              className={`exercise-card ${active ? "expanded" : ""}`}
              key={entry.id}
            >
              <button
                className="exercise-toggle"
                onClick={() => setExpanded(active ? "" : entry.id)}
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
                    {entry.prescribed.targetReps ??
                      entry.prescribed.reps ??
                      "—"}{" "}
                    reps ·{" "}
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
                  <p className="muted">{entry.prescribed.notes}</p>
                  {previous && (
                    <p className="previous">
                      Last session:{" "}
                      {previous.sets
                        .filter(isValidLoggedSet)
                        .map((s) => `${s.weight} kg × ${s.reps}`)
                        .join(" · ") || "No logged sets"}
                    </p>
                  )}
                  <div className="set-labels">
                    <span>SET</span>
                    <span>WEIGHT · KG</span>
                    <span>REPS</span>
                    <span>RESULT</span>
                  </div>
                  {entry.sets.map((set, i) => (
                    <div
                      className={`set-group ${set.result === "success" || set.logged ? "logged" : ""} ${set.result === "miss" ? "missed" : ""}`}
                      key={set.id}
                    >
                      <div className="set-row">
                        <span className="set-number">{i + 1}</span>
                        <NumericInput
                          label={`Set ${i + 1} weight in kilograms`}
                          value={set.weight}
                          onChange={(value) =>
                            changeEntry(entry.id, (e) =>
                              updatePendingSets(e, set.id, "weight", value),
                            )
                          }
                        />
                        <NumericInput
                          label={`Set ${i + 1} repetitions`}
                          value={set.reps}
                          step="1"
                          onChange={(value) =>
                            changeEntry(entry.id, (e) =>
                              updatePendingSets(e, set.id, "reps", value),
                            )
                          }
                        />
                        <div className="result-buttons">
                          <button
                            className={
                              set.result === "success" || set.logged
                                ? "made"
                                : ""
                            }
                            aria-label={`Set ${i + 1} made`}
                            aria-pressed={
                              set.result === "success" || Boolean(set.logged)
                            }
                            onClick={() =>
                              changeEntry(entry.id, (e) => {
                                const s = e.sets.find((s) => s.id === set.id)!;
                                if (
                                  !isValidLoggedSet({
                                    ...s,
                                    result: "success",
                                    logged: true,
                                  })
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
                          </button>
                          <button
                            className={set.result === "miss" ? "miss" : ""}
                            aria-label={`Set ${i + 1} missed`}
                            aria-pressed={set.result === "miss"}
                            onClick={() =>
                              changeEntry(entry.id, (e) => {
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
                                changeEntry(entry.id, (e) => {
                                  const s = e.sets.find(
                                    (s) => s.id === set.id,
                                  )!;
                                  updatePendingSets(
                                    e,
                                    set.id,
                                    "weight",
                                    String(
                                      Math.max(
                                        0,
                                        wholeKilograms(s.weight) + delta,
                                      ),
                                    ),
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
                                changeEntry(entry.id, (e) =>
                                  updatePendingSets(e, set.id, "rpe", value),
                                )
                              }
                            />
                          </label>
                          <Button
                            variant="ghost"
                            disabled={i === 0}
                            onClick={() =>
                              changeEntry(entry.id, (e) => {
                                const prior = e.sets[i - 1];
                                updatePendingSets(
                                  e,
                                  set.id,
                                  "weight",
                                  String(prior.weight),
                                );
                                updatePendingSets(
                                  e,
                                  set.id,
                                  "reps",
                                  String(prior.reps),
                                );
                              })
                            }
                          >
                            <Copy size={16} />
                            Previous set
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              changeEntry(entry.id, (e) => {
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
                  ))}
                  <div className="section-top">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        changeEntry(entry.id, (e) => {
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
                  <details className="notes">
                    <summary>Notes & coach cue</summary>
                    <div className="form-grid">
                      <label>
                        Your notes
                        <textarea
                          value={entry.athleteNotes}
                          onChange={(e) =>
                            changeEntry(entry.id, (item) => {
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
                            changeEntry(entry.id, (item) => {
                              item.coachCue = e.target.value;
                            })
                          }
                        />
                      </label>
                    </div>
                  </details>
                  <Button
                    className="full"
                    onClick={() => {
                      if (
                        !entry.sets.length ||
                        !entry.sets.every(isValidLoggedSet)
                      ) {
                        notify(
                          "Log every remaining set before completing this exercise, or finish a partial workout.",
                        );
                        return;
                      }
                      changeEntry(entry.id, (e) => {
                        e.completed = true;
                      });
                      setExpanded(draft.exercises[index + 1]?.id ?? entry.id);
                    }}
                  >
                    Complete {exerciseName(entry.exerciseId)}{" "}
                    <ArrowRight size={18} />
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="panel add-exercise">
        <label>
          Add an exercise
          <select value={add} onChange={(e) => setAdd(e.target.value)}>
            {EXERCISES.map((e) => (
              <option value={e.id} key={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          onClick={() =>
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
              setExpanded(entry.id);
            })
          }
        >
          <Plus size={18} />
          Add exercise
        </Button>
      </div>
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
        title="Save your session?"
        description={`You've logged ${logged} of ${total} sets. Only recorded sets will be saved; a partial session will not unlock a load increase.`}
      >
        <div className="button-row">
          <Button onClick={() => void complete()}>Save workout</Button>
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
      <Dialog
        open={candidates.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setCandidates([]);
          }
        }}
        title="A new personal best?"
        description="These logged weights exceed your recorded PRs. Confirm the lifts you want to keep as personal bests."
      >
        <div>
          {candidates.map(([id, weight]) => (
            <div className="load-row" key={id}>
              <span>{exerciseName(id)}</span>
              <strong>{weight} kg</strong>
            </div>
          ))}
        </div>
        <div className="button-row">
          <Button onClick={() => void saveFinished(true)}>
            Update personal bests
          </Button>
          <Button variant="secondary" onClick={() => void saveFinished(false)}>
            Keep current PRs
          </Button>
        </div>
      </Dialog>
    </>
  );
}
