import { z } from "zod";
import {
  days,
  EXERCISES,
  exerciseName,
  followsProgramme,
  PR_DEFINITIONS,
  program,
  proposedReset,
} from "./domain";
import { restSeconds } from "./exercises";
import type { JournalState, Plan, Workout } from "./model";
import { nativeResponses } from "./native-api";
import { nextTraining } from "./next-training";
import { shortSleepHint } from "./training";
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
    rpe: z.number().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "WorkoutSet" });
// Why the programme set today's load, for the workout in progress.
const workoutProgression = z
  .object({
    // "increase", "hold", "return" after a break, "confirm" (under 18,
    // waiting for a coach's technique check), "reset", "initial", "choose"
    // or "limit".
    status: z.string(),
    reason: z.string(),
    // A lighter load the plan proposes after two failed sessions, until a
    // set is logged.
    resetWeight: z.number().optional(),
  })
  .strict()
  .register(nativeResponses, { id: "WorkoutProgression" });
const workoutExercise = z
  .object({
    entryId: z.string(),
    exerciseId: z.string(),
    name: z.string(),
    target: z.string().optional(),
    notes: z.string().optional(),
    sets: z.array(workoutSet),
    progression: workoutProgression.optional(),
    // Where the rest timer starts after a set.
    restSeconds: int.optional(),
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
    // For a programme workout in progress: "auto", or "limited" to repeat
    // the previous loads.
    recovery: z.string().optional(),
    // A short night before the session, suggesting limited recovery.
    recoveryHint: z.string().optional(),
    // Under 18, while an increase waits for a coach's technique check:
    // whether it was confirmed for this workout.
    techniqueCheck: z.boolean().optional(),
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
const personalBest = z
  .object({
    exerciseId: z.string(),
    name: z.string(),
    weight: z.number(),
    reps: int.optional(),
    // When it was first lifted; absent for a best entered by hand.
    date: day.optional(),
  })
  .strict()
  .register(nativeResponses, { id: "PersonalBest" });
const trainingWeek = z
  .object({
    // The Monday the week starts on.
    start: day,
    sessions: int,
    sets: int,
    tonnageKg: z.number(),
  })
  .strict()
  .register(nativeResponses, { id: "TrainingWeek" });
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
    // The main lifts' best made sets, and the last eight weeks' work, for
    // progress at a glance.
    bests: z.array(personalBest).optional(),
    weeks: z.array(trainingWeek).optional(),
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

const planOf = (e: Workout["exercises"][number]) =>
  e.prescribed?.progression as Plan | undefined;

// A workout as the app shows it. The journal is passed for the workout in
// progress, which also carries its plan: why each load, rest, recovery and
// the under-18 technique check.
export function workoutView(
  w: Workout,
  finished: boolean,
  state?: JournalState,
) {
  const ongoing = !finished && state ? state : undefined;
  const programme = ongoing != null && followsProgramme(w);
  return workoutDetail.parse(
    defined({
      id: w.id,
      title: w.title,
      date: w.date,
      finished,
      notes: w.athleteNotes || undefined,
      recovery: programme ? w.recovery : undefined,
      recoveryHint:
        programme && w.recovery === "auto"
          ? shortSleepHint(ongoing, w.date)
          : undefined,
      techniqueCheck:
        ongoing &&
        (w.techniqueChecked === true ||
          w.exercises.some((e) => planOf(e)?.status === "confirm"))
          ? w.techniqueChecked === true
          : undefined,
      exercises: w.exercises.map((e) => {
        const target = e.prescribed?.targetSets
          ? `${e.prescribed.targetSets} × ${e.prescribed.reps ?? e.prescribed.targetReps ?? ""}${
              number(e.prescribed.targetWeight) != null
                ? ` · ${number(e.prescribed.targetWeight)} kg`
                : ""
            }`
          : undefined;
        const plan = planOf(e);
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
              rpe: number(s.rpe),
            }),
          ),
          progression:
            ongoing && plan && plan.status !== "manual" && plan.reason
              ? defined({
                  status: plan.status,
                  reason: plan.reason,
                  resetWeight: proposedReset(e),
                })
              : undefined,
          restSeconds: ongoing
            ? restSeconds(e, ongoing.preferences.restSeconds)
            : undefined,
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

const madeSets = (w: Workout) =>
  w.exercises.flatMap((e) =>
    e.sets
      .filter((s) => isValidLoggedSet(s) && s.result !== "miss")
      .map((s) => ({
        exerciseId: e.exerciseId,
        weight: Number(s.weight) || 0,
        reps: Number(s.reps) || 0,
      })),
  );

// The heaviest made set of each main lift, from the date it was first made,
// or the best entered by hand when that is heavier.
export function personalBests(
  state: JournalState,
): z.infer<typeof personalBest>[] {
  const found = new Map<
    string,
    { weight: number; reps: number; date: string }
  >();
  for (const w of state.sessions)
    for (const set of madeSets(w)) {
      const best = found.get(set.exerciseId);
      if (
        set.weight > 0 &&
        (!best ||
          set.weight > best.weight ||
          (set.weight === best.weight && w.date < best.date))
      )
        found.set(set.exerciseId, { ...set, date: w.date });
    }
  return PR_DEFINITIONS.flatMap(({ exerciseId }) => {
    const lifted = found.get(exerciseId);
    const entered = state.prs[exerciseId] ?? 0;
    const name = exerciseName(exerciseId);
    if (entered > (lifted?.weight ?? 0))
      return [{ exerciseId, name, weight: entered }];
    return lifted
      ? [
          defined({
            exerciseId,
            name,
            weight: lifted.weight,
            reps: lifted.reps || undefined,
            date: lifted.date,
          }),
        ]
      : [];
  });
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Sessions, sets and kilos lifted in each of the last eight weeks, Monday to
// Sunday, oldest first; the last week is the one holding date.
export function trainingWeeks(state: JournalState, date: string, count = 8) {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const first = addDays(date, -weekday - 7 * (count - 1));
  const weeks = Array.from({ length: count }, (_, i) => ({
    start: addDays(first, 7 * i),
    sessions: 0,
    sets: 0,
    tonnageKg: 0,
  }));
  for (const w of state.sessions) {
    const index = Math.floor(
      (Date.parse(`${w.date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
        (7 * 86400000),
    );
    const week = weeks[index];
    if (!week || w.date > date) continue;
    const sets = madeSets(w);
    week.sessions++;
    week.sets += w.exercises.reduce(
      (n, e) => n + e.sets.filter(isValidLoggedSet).length,
      0,
    );
    week.tonnageKg += sets.reduce((n, s) => n + s.weight * s.reps, 0);
  }
  return weeks.map((w) => ({ ...w, tonnageKg: Math.round(w.tonnageKg) }));
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
        ? workoutView(state.activeWorkout, false, state)
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
      bests: personalBests(state),
      weeks: trainingWeeks(state, date),
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
    return workoutView(state.activeWorkout, false, state);
  const session = state.sessions.find((s) => s.id === id);
  return session ? workoutView(session, true) : null;
}
