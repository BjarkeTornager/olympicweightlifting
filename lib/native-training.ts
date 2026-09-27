import { z } from "zod";
import { days, EXERCISES, exerciseName, program } from "./domain";
import type { JournalState, Workout } from "./model";
import { nativeResponses } from "./native-api";
import { nextTraining } from "./next-training";
import {
  plannedCardioText,
  prescriptionText,
  trainingPrograms,
} from "./training-programs";
import { isValidLoggedSet } from "../js/progression.js";

// Train in the iPhone app: programmes (the built-in one and the athlete's
// own), the ongoing workout set by set, and finished sessions in full. Views
// shaped for the app, like native-api.ts; optional fields are omitted.
const int = z.number().int();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const workoutSet = z
  .object({
    id: z.string(),
    weight: z.number().optional(),
    reps: int.optional(),
    // "success", "miss", or "" for a planned set not yet done.
    result: z.string(),
    logged: z.boolean(),
  })
  .strict()
  .register(nativeResponses, { id: "WorkoutSet" });
const workoutExercise = z
  .object({
    entryId: z.string(),
    exerciseId: z.string(),
    name: z.string(),
    target: z.string().optional(),
    notes: z.string().optional(),
    sets: z.array(workoutSet),
  })
  .strict()
  .register(nativeResponses, { id: "WorkoutExercise" });
export const workoutDetail = z
  .object({
    id: z.string(),
    title: z.string(),
    date: day,
    finished: z.boolean(),
    notes: z.string().optional(),
    exercises: z.array(workoutExercise),
  })
  .strict()
  .register(nativeResponses, { id: "WorkoutDetail" });
const plannedExercise = z
  .object({
    exerciseId: z.string(),
    name: z.string(),
    sets: int,
    reps: int,
    repsMax: int.optional(),
    weight: z.number().optional(),
    restSeconds: int.optional(),
    targetRpe: z.number().optional(),
    notes: z.string().optional(),
    text: z.string(),
  })
  .strict()
  .register(nativeResponses, { id: "PlannedExercise" });
const programmeDay = z
  .object({
    id: z.string(),
    name: z.string(),
    notes: z.string().optional(),
    exercises: z.array(plannedExercise),
    cardio: z.array(z.string()),
  })
  .strict()
  .register(nativeResponses, { id: "ProgrammeDay" });
const programme = z
  .object({
    id: z.string(),
    name: z.string(),
    notes: z.string().optional(),
    builtIn: z.boolean(),
    active: z.boolean(),
    weeks: int.optional(),
    days: z.array(programmeDay),
  })
  .strict()
  .register(nativeResponses, { id: "Programme" });
const sessionSummary = z
  .object({
    id: z.string(),
    title: z.string(),
    date: day,
    exercises: int,
    loggedSets: int,
    topSet: z.string().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "SessionSummary" });
const exerciseOption = z
  .object({ id: z.string(), name: z.string(), category: z.string() })
  .strict()
  .register(nativeResponses, { id: "ExerciseOption" });
export const trainingView = z
  .object({
    revision: int,
    activeWorkout: workoutDetail.optional(),
    next: z
      .object({
        programmeId: z.string(),
        programmeName: z.string(),
        dayId: z.string(),
        title: z.string(),
        position: int,
        count: int,
        builtIn: z.boolean(),
        canStart: z.boolean(),
      })
      .strict()
      .register(nativeResponses, { id: "NextTraining" })
      .optional(),
    programmes: z.array(programme),
    recent: z.array(sessionSummary),
    exercises: z.array(exerciseOption),
  })
  .strict()
  .register(nativeResponses, { id: "Training" });
export type TrainingView = z.infer<typeof trainingView>;

const number = (value: unknown) => {
  if (value === "" || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const defined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as T;

export function workoutView(w: Workout, finished: boolean) {
  return workoutDetail.parse(
    defined({
      id: w.id,
      title: w.title,
      date: w.date,
      finished,
      notes: w.athleteNotes || undefined,
      exercises: w.exercises.map((e) => {
        const target = e.prescribed?.targetSets
          ? `${e.prescribed.targetSets} × ${e.prescribed.reps ?? e.prescribed.targetReps ?? ""}${
              number(e.prescribed.targetWeight) != null
                ? ` · ${number(e.prescribed.targetWeight)} kg`
                : ""
            }`
          : undefined;
        return defined({
          entryId: e.id,
          exerciseId: e.exerciseId,
          name: exerciseName(e.exerciseId),
          target,
          notes: e.athleteNotes || undefined,
          sets: e.sets.map((s) =>
            defined({
              id: s.id,
              weight: number(s.weight),
              reps: number(s.reps),
              result: s.result ?? "",
              logged: isValidLoggedSet(s),
            }),
          ),
        });
      }),
    }),
  );
}

// The heaviest made set, "Snatch 72 kg × 2", for the history list.
function topSet(w: Workout) {
  let best: { name: string; weight: number; reps: number } | undefined;
  for (const e of w.exercises)
    for (const s of e.sets)
      if (isValidLoggedSet(s) && s.result !== "miss") {
        const weight = Number(s.weight);
        if (!best || weight > best.weight)
          best = {
            name: exerciseName(e.exerciseId),
            weight,
            reps: Number(s.reps),
          };
      }
  return best && best.weight > 0
    ? `${best.name} ${best.weight} kg × ${best.reps}`
    : undefined;
}

export function buildTraining(
  state: JournalState,
  revision: number,
  date: string,
): TrainingView {
  const next = state.activeWorkout ? undefined : nextTraining(state, date);
  const custom = trainingPrograms(state).map((p) =>
    defined({
      id: p.id,
      name: p.name,
      notes: p.notes || undefined,
      builtIn: false,
      active: state.program.activeProgramId === p.id,
      weeks: p.weeks ?? undefined,
      days: p.days.map((d) =>
        defined({
          id: d.id,
          name: d.name,
          notes: d.notes || undefined,
          exercises: d.exercises.map((e) =>
            defined({
              exerciseId: e.exerciseId,
              name: exerciseName(e.exerciseId),
              sets: e.sets,
              reps: e.reps,
              repsMax: e.repsMax,
              weight: e.weight ?? undefined,
              restSeconds: e.restSeconds,
              targetRpe: e.targetRpe,
              notes: e.notes || undefined,
              text: prescriptionText(e),
            }),
          ),
          cardio: (d.cardio ?? []).map(plannedCardioText),
        }),
      ),
    }),
  );
  const builtIn = defined({
    id: program.id,
    name: program.name,
    builtIn: true,
    active: !custom.some((p) => p.active),
    days: days.map((d) => ({
      id: d.id,
      name: d.title,
      ...(d.focus ? { notes: d.focus } : {}),
      exercises: d.exercises.map((e) => {
        const sets = typeof e.sets === "number" ? e.sets : e.sets.default;
        const weight = number(e.initialWeight);
        return defined({
          exerciseId: e.exerciseId,
          name: exerciseName(e.exerciseId),
          sets,
          reps: e.defaultReps,
          weight,
          notes: e.notes || undefined,
          text: `${sets} × ${e.reps}${weight != null ? ` · ${weight} kg` : ""}`,
        });
      }),
      cardio: [],
    })),
  });
  return trainingView.parse(
    defined({
      revision,
      activeWorkout: state.activeWorkout
        ? workoutView(state.activeWorkout, false)
        : undefined,
      next: next
        ? {
            programmeId: next.programId,
            programmeName: next.programName,
            dayId: next.dayId,
            title: next.title,
            position: next.position,
            count: next.count,
            builtIn: !next.custom,
            canStart: next.canStart,
          }
        : undefined,
      programmes: [...custom, builtIn],
      recent: [...state.sessions]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30)
        .map((s) =>
          defined({
            id: s.id,
            title: s.title,
            date: s.date,
            exercises: s.exercises.length,
            loggedSets: s.exercises.reduce(
              (n, e) => n + e.sets.filter(isValidLoggedSet).length,
              0,
            ),
            topSet: topSet(s),
          }),
        ),
      exercises: EXERCISES.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category ?? "Other",
      })),
    }),
  );
}

export function findSession(state: JournalState, id: string) {
  if (state.activeWorkout?.id === id)
    return workoutView(state.activeWorkout, false);
  const session = state.sessions.find((s) => s.id === id);
  return session ? workoutView(session, true) : null;
}
