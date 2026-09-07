"use client";
import { useState } from "react";
import { ArrowRight, ChevronDown, Play, Sparkles, Trash2 } from "./ui/icons";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { exerciseName } from "@/lib/domain";
import { formatSet } from "@/lib/training";
import {
  trainingPrograms,
  prescriptionText,
  plannedCardioText,
  startTrainingDay,
} from "@/lib/training-programs";
import {
  isTrainingProgram,
  type TrainingProgram,
  type TrainingDay,
} from "@/lib/training-program-schema";
import type { JournalState, WorkoutTemplate } from "@/lib/model";
import type { TrainingReview } from "@/lib/agent/actions";
import type { JournalController } from "./journal";

function RoutineDetails({ routine }: { routine: WorkoutTemplate }) {
  return (
    <div className="training-prescriptions">
      {routine.exercises.map((e, i) => {
        const sets = e.sets.map((s) => formatSet(s.weight, s.reps));
        return (
          <div key={i}>
            <strong>{exerciseName(e.exerciseId)}</strong>
            <p>
              {new Set(sets).size === 1
                ? `${sets.length} sets · ${sets[0]}`
                : sets.map((s, j) => `Set ${j + 1}: ${s}`).join(" · ")}
            </p>
          </div>
        );
      })}
    </div>
  );
}
export function ProgramDetails({
  program,
  renderAction,
}: {
  program: TrainingProgram;
  renderAction?: (day: TrainingDay) => React.ReactNode;
}) {
  return (
    <div className="training-program-details">
      <p className="muted">
        {program.days.length} {program.days.length === 1 ? "day" : "days"}
        {program.weeks ? ` · ${program.weeks} weeks` : " · Repeat at your pace"}
      </p>
      {program.notes && (
        <p className="training-instructions">{program.notes}</p>
      )}
      {program.days.map((day, i) => (
        <details
          className="training-day"
          key={day.id}
          open={program.days.length === 1 ? true : undefined}
        >
          <summary>
            <span className="training-day-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>
              <strong>{day.name}</strong>
              <small>
                {day.exercises.length
                  ? `${day.exercises.length} exercises · ${day.exercises.reduce((n, e) => n + e.sets, 0)} sets`
                  : day.cardio?.length
                    ? "Cardio & movement"
                    : "Recovery"}
                {day.exercises.length && day.cardio?.length ? " · Cardio" : ""}
              </small>
            </span>
            <ChevronDown size={18} />
          </summary>
          <div className="training-day-content">
            {day.notes && <p className="training-instructions">{day.notes}</p>}
            <div className="training-prescriptions">
              {day.exercises.map((e, index) => (
                <div key={index}>
                  <strong>{exerciseName(e.exerciseId)}</strong>
                  <p>{prescriptionText(e)}</p>
                  {e.notes && (
                    <p className="training-instructions">{e.notes}</p>
                  )}
                </div>
              ))}
            </div>
            {!!day.cardio?.length && (
              <div className="training-prescriptions">
                <span className="eyebrow">Planned movement</span>
                {day.cardio.map((c, index) => (
                  <p key={index}>{plannedCardioText(c)}</p>
                ))}
                <p className="fine-print">
                  Log what you actually complete in Cardio & movement.
                </p>
              </div>
            )}
            {renderAction?.(day)}
          </div>
        </details>
      ))}
    </div>
  );
}
export function TrainingReviewDetails({ review }: { review: TrainingReview }) {
  return (
    <div className="training-review">
      <h3>{review.after.name}</h3>
      {review.kind === "routine" ? (
        <RoutineDetails routine={review.after} />
      ) : (
        <ProgramDetails program={review.after} />
      )}
      {review.before && (
        <details className="training-before">
          <summary>Compare with the saved version</summary>
          <h3>{review.before.name}</h3>
          {review.kind === "routine" ? (
            <RoutineDetails routine={review.before} />
          ) : (
            <ProgramDetails program={review.before} />
          )}
        </details>
      )}
    </div>
  );
}
export function TrainingPrograms({
  state,
  update,
  date,
  go,
  notify,
}: {
  state: JournalState;
  update: JournalController["update"];
  date: string;
  go: (route: string) => void;
  notify: (message: string) => void;
}) {
  const [removing, setRemoving] = useState<TrainingProgram | null>(null);
  const programs = trainingPrograms(state);
  return (
    <section className="panel training-programs-panel">
      <div className="section-top">
        <div>
          <h2>Your programs</h2>
          <p className="muted">
            A plan that fits your training, built with Coach.
          </p>
        </div>
        <Button variant="secondary" onClick={() => go("coach/training/new")}>
          <Sparkles size={17} />
          Build with Coach
        </Button>
      </div>
      {!programs.length && (
        <p className="fine-print">
          Ask for a gym split, an accessory plan or a mix of strength, cardio
          and recovery. Review it in chat, then start a day here.
        </p>
      )}
      <div className="training-program-list">
        {programs.map((p) => (
          <article className="training-program-card" key={p.id}>
            <div className="section-top">
              <h3>{p.name}</h3>
              <Button
                variant="ghost"
                aria-label={`Delete ${p.name}`}
                onClick={() => setRemoving(p)}
              >
                <Trash2 size={17} />
              </Button>
            </div>
            <ProgramDetails
              program={p}
              renderAction={(day) => (
                <div className="button-row">
                  {!!day.exercises.length && (
                    <Button
                      disabled={Boolean(state.activeWorkout)}
                      onClick={async () => {
                        try {
                          await update((s) => {
                            if (s.activeWorkout)
                              throw Error(
                                "Resume or finish your unfinished workout first.",
                              );
                            const current = trainingPrograms(s).find(
                              (program) => program.id === p.id,
                            );
                            if (!current)
                              throw Error(
                                "This program changed. Reopen Train before starting.",
                              );
                            s.activeWorkout = startTrainingDay(
                              current,
                              day.id,
                              date,
                            );
                          });
                          go("workout");
                        } catch (e) {
                          notify(
                            e instanceof Error
                              ? e.message
                              : "Could not start this training day.",
                          );
                        }
                      }}
                    >
                      <Play size={17} />
                      Start workout
                    </Button>
                  )}
                  {!!day.cardio?.length && (
                    <Button variant="secondary" onClick={() => go("cardio")}>
                      Cardio & movement
                      <ArrowRight size={17} />
                    </Button>
                  )}
                </div>
              )}
            />
            <Button
              variant="ghost"
              onClick={() => go(`coach/training/${p.id}`)}
            >
              <Sparkles size={17} />
              Edit with Coach
            </Button>
          </article>
        ))}
      </div>
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Delete this training program?"
        description="Completed sessions and your unfinished workout will be kept."
      >
        <p>{removing?.name}</p>
        <div className="button-row">
          <Button variant="secondary" onClick={() => setRemoving(null)}>
            Keep program
          </Button>
          <Button
            onClick={async () => {
              if (!removing) return;
              try {
                await update((s) => {
                  s.program.customPrograms = s.program.customPrograms.filter(
                    (p) => !isTrainingProgram(p) || p.id !== removing.id,
                  );
                });
                setRemoving(null);
                notify("Training program deleted.");
              } catch (e) {
                notify(
                  e instanceof Error
                    ? e.message
                    : "Could not delete this program.",
                );
              }
            }}
          >
            Delete program
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
