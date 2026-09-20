import { createWorkout, days, program, today } from "./domain";
import type { JournalState } from "./model";
import { startTrainingDay, trainingPrograms } from "./training-programs";
import { isValidLoggedSet } from "../js/progression.js";

export function nextTraining(state: JournalState, date = today()) {
  const selected = trainingPrograms(state).find(
    (p) => p.id === state.program.activeProgramId,
  );
  const plan = selected ?? {
    id: program.id,
    name: program.name,
    // Any-day alternatives are optional sessions, not steps in the base plan.
    days: days
      .filter((d) => d.weekday !== null)
      .map((d) => ({ ...d, name: d.title, notes: d.focus })),
  };
  const completed = [...state.sessions]
    .reverse()
    .filter(
      (s) =>
        s.programId === plan.id &&
        s.date <= date &&
        plan.days.some((d) => d.id === s.programDayId) &&
        s.exercises.some((e) => e.sets.some(isValidLoggedSet)),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.finishedAt ?? b.startedAt ?? "").localeCompare(
          a.finishedAt ?? a.startedAt ?? "",
        ),
    );
  const previous = completed[0];
  const index = previous
    ? (plan.days.findIndex((d) => d.id === previous.programDayId) + 1) %
      plan.days.length
    : 0;
  const day = plan.days[index];
  return {
    programId: plan.id,
    programName: plan.name,
    dayId: day.id,
    title: day.name,
    notes: day.notes,
    exercises: day.exercises.length,
    custom: Boolean(selected),
    canStart: day.exercises.length > 0,
    previousDate: previous?.date,
    position: index + 1,
    count: plan.days.length,
  };
}

export function startNextTraining(state: JournalState, date = today()) {
  if (state.activeWorkout)
    throw Error("Resume or finish your ongoing workout first.");
  const next = nextTraining(state, date);
  if (!next.canStart)
    throw Error(
      "This is an activity or recovery day. Open the programme to follow its instructions.",
    );
  const selected = trainingPrograms(state).find((p) => p.id === next.programId);
  state.activeWorkout = selected
    ? startTrainingDay(selected, next.dayId, date)
    : createWorkout(
        state,
        days.find((d) => d.id === next.dayId),
        date,
      );
}
