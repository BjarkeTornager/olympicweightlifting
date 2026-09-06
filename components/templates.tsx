"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { EXERCISES, exerciseName, uid } from "@/lib/domain";
import {
  templateSchema,
  type JournalState,
  type WorkoutTemplate,
} from "@/lib/model";
import { startTemplate } from "@/lib/training";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
export function Templates({
  state,
  update,
  date,
  go,
  notify,
}: {
  state: JournalState;
  update: JournalController["update"];
  date: string;
  go: (r: string) => void;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState<WorkoutTemplate | null>(null);
  const [error, setError] = useState("");
  const edit = (fn: (t: WorkoutTemplate) => void) =>
    setDraft((old) => {
      if (!old) return old;
      const next = structuredClone(old);
      fn(next);
      return next;
    });
  return (
    <section className="panel templates-panel">
      <div className="section-top">
        <div>
          <h2>Your routines</h2>
          <p className="muted">Keep a favourite session ready to repeat.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setError("");
            setDraft({ id: uid(), name: "My routine", exercises: [] });
          }}
        >
          <Plus size={17} />
          New routine
        </Button>
      </div>
      {!state.templates?.length && (
        <p>Build a routine here, or save a completed session from History.</p>
      )}
      <div className="routine-list">
        {state.templates?.map((t) => (
          <div key={t.id}>
            <span>
              <strong>{t.name}</strong>
              <small>
                {t.exercises.length} exercises ·{" "}
                {t.exercises.reduce((n, e) => n + e.sets.length, 0)} sets
              </small>
            </span>
            <div className="button-row">
              <Button
                variant="secondary"
                disabled={Boolean(state.activeWorkout)}
                onClick={async () => {
                  try {
                    await update((s) => {
                      if (s.activeWorkout)
                        throw Error("Resume your unfinished workout first.");
                      s.activeWorkout = startTemplate(t, date);
                    });
                    go("workout");
                  } catch (e) {
                    notify(
                      e instanceof Error
                        ? e.message
                        : "Could not start routine.",
                    );
                  }
                }}
              >
                Start
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setError("");
                  setDraft(structuredClone(t));
                }}
              >
                Edit
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
        title="Your routine"
        description="Choose exercises, order and starting sets. Repeated sessions begin with every set unlogged."
      >
        {draft && (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const parsed = templateSchema.parse(draft);
                await update((s) => {
                  s.templates = [
                    ...(s.templates ?? []).filter((t) => t.id !== parsed.id),
                    parsed,
                  ];
                });
                setDraft(null);
                notify("Routine saved.");
              } catch {
                setError(
                  "Add at least one exercise and check the routine name, weights and reps.",
                );
              }
            }}
          >
            <label>
              Routine name
              <input
                value={draft.name}
                required
                maxLength={120}
                onChange={(e) =>
                  edit((t) => {
                    t.name = e.target.value;
                  })
                }
              />
            </label>
            {draft.exercises.map((entry, index) => (
              <fieldset key={index} className="routine-editor">
                <legend>{exerciseName(entry.exerciseId)}</legend>
                <div className="button-row">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move ${exerciseName(entry.exerciseId)} up`}
                    onClick={() =>
                      edit((t) => {
                        [t.exercises[index - 1], t.exercises[index]] = [
                          t.exercises[index],
                          t.exercises[index - 1],
                        ];
                      })
                    }
                  >
                    <ArrowUp size={17} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={index === draft.exercises.length - 1}
                    aria-label={`Move ${exerciseName(entry.exerciseId)} down`}
                    onClick={() =>
                      edit((t) => {
                        [t.exercises[index + 1], t.exercises[index]] = [
                          t.exercises[index],
                          t.exercises[index + 1],
                        ];
                      })
                    }
                  >
                    <ArrowDown size={17} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${exerciseName(entry.exerciseId)}`}
                    onClick={() =>
                      edit((t) => {
                        t.exercises.splice(index, 1);
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </Button>
                </div>
                {entry.sets.map((set, i) => (
                  <div className="routine-set" key={i}>
                    <label>
                      Set {i + 1} · kg
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100000"
                        step="any"
                        required
                        value={set.weight}
                        onChange={(e) =>
                          edit((t) => {
                            t.exercises[index].sets[i].weight = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      Reps
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="1000"
                        step="1"
                        required
                        value={set.reps}
                        onChange={(e) =>
                          edit((t) => {
                            t.exercises[index].sets[i].reps = e.target.value;
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={entry.sets.length === 1}
                      aria-label={`Remove set ${i + 1}`}
                      onClick={() =>
                        edit((t) => {
                          t.exercises[index].sets.splice(i, 1);
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={entry.sets.length >= 100}
                  onClick={() =>
                    edit((t) => {
                      const sets = t.exercises[index].sets;
                      sets.push({ ...sets.at(-1)! });
                    })
                  }
                >
                  Add set
                </Button>
              </fieldset>
            ))}
            <label>
              Add exercise
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value)
                    edit((t) => {
                      t.exercises.push({
                        exerciseId: e.target.value,
                        sets: [{ weight: 0, reps: 8 }],
                      });
                    });
                }}
              >
                <option value="">Choose exercise</option>
                {EXERCISES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <Button type="submit">Save routine</Button>
              {state.templates?.some((t) => t.id === draft.id) && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={async () => {
                    await update((s) => {
                      s.templates = s.templates.filter(
                        (t) => t.id !== draft.id,
                      );
                    });
                    setDraft(null);
                    notify("Routine deleted. You can undo the last change.");
                  }}
                >
                  Delete routine
                </Button>
              )}
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
