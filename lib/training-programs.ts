import { uid } from "./domain";
import { cardioLabels, formatDuration } from "./cardio";
import type { JournalState, Workout } from "./model";
import {
  isTrainingProgram,
  trainingProgramSchema,
  type TrainingProgram,
  type TrainingProgramInput,
  type TrainingDay,
  type ProgramExercisePrescription,
} from "./training-program-schema";
import { startTemplate } from "./training";

export function trainingPrograms(state: JournalState) {
  return state.program.customPrograms.filter(isTrainingProgram);
}
export function ownedProgram(state: JournalState, id: string) {
  const p = trainingPrograms(state).find((p) => p.id === id);
  if (!p)
    throw Error(
      "That training program is not in your journal. Read training_library for the correct ID.",
    );
  return p;
}
export function saveTrainingProgram(
  state: JournalState,
  input: TrainingProgramInput,
  original?: TrainingProgram,
) {
  const program = trainingProgramSchema.parse({
    ...input,
    kind: "training-program",
    version: 1,
    id: original?.id ?? uid(),
    days: input.days.map((d) => {
      if (d.id && !original?.days.some((old) => old.id === d.id))
        throw Error(
          "A supplied day ID must belong to the program being edited. Omit IDs for new days.",
        );
      return { ...d, id: d.id ?? uid() };
    }),
  });
  if (original)
    state.program.customPrograms = state.program.customPrograms.map((p) =>
      isTrainingProgram(p) && p.id === original.id ? program : p,
    );
  else state.program.customPrograms.push(program);
  return program;
}
export function prescriptionText(e: ProgramExercisePrescription) {
  return `${e.sets} × ${e.reps}${e.repsMax && e.repsMax !== e.reps ? `–${e.repsMax}` : ""} · ${e.weight == null ? "Choose load" : e.weight === 0 ? "Bodyweight" : `${e.weight} kg`}${e.targetRpe ? ` · Target RPE ${e.targetRpe}` : ""}${e.restSeconds != null ? ` · Rest ${e.restSeconds}s` : ""}`;
}
export function plannedCardioText(
  c: NonNullable<TrainingDay["cardio"]>[number],
) {
  return [
    c.title || cardioLabels[c.activity],
    c.durationSeconds ? formatDuration(c.durationSeconds) : "",
    c.distanceKm ? `${c.distanceKm} km` : "",
    c.notes,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function startTrainingDay(
  program: TrainingProgram,
  dayId: string,
  date: string,
): Workout {
  const day = program.days.find((d) => d.id === dayId);
  if (!day) throw Error("Choose a day from this training program.");
  if (!day.exercises.length)
    throw Error(
      "This day has no strength sets. Follow its activity or recovery instructions in Train, and log cardio after completing it.",
    );
  const workout = startTemplate(
    {
      id: day.id,
      name: day.name,
      exercises: day.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        sets: Array.from({ length: e.sets }, () => ({
          weight: e.weight ?? "",
          reps: e.reps,
        })),
      })),
    },
    date,
  );
  workout.programId = program.id;
  workout.coachNotes = [
    program.notes,
    day.notes,
    ...(day.cardio ?? []).map(
      (c) => `Planned activity: ${plannedCardioText(c)}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (workout.coachNotes.length > 10000)
    workout.coachNotes = [
      program.notes,
      day.notes,
      "Planned activity — full instructions are in Train → Your programs:",
      ...(day.cardio ?? []).map((c) =>
        plannedCardioText({ ...c, notes: undefined }),
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
  workout.exercises.forEach((entry, i) => {
    const e = day.exercises[i];
    entry.prescribed = {
      targetSets: e.sets,
      targetWeight: e.weight ?? "",
      reps: e.repsMax ? `${e.reps}–${e.repsMax}` : String(e.reps),
      notes: [prescriptionText(e), e.notes].filter(Boolean).join(". "),
      ...(e.restSeconds != null ? { restSeconds: e.restSeconds } : {}),
      ...(e.targetRpe != null ? { targetRpe: e.targetRpe } : {}),
    };
  });
  return workout;
}
