import {
  createEntry,
  createWorkout,
  emptyJournal,
  days,
} from "../../lib/domain";
import { offsetDate, saveCheckin } from "../../lib/health";
import type { LiftingBriefInput } from "../../lib/lifting-coach";
import type { JournalState } from "../../lib/model";

export const liftingBrief: LiftingBriefInput = {
  goal: "Feel confident with my snatch",
  why: "Enjoy a local competition",
  experience: "developing",
  daysPerWeek: 3,
  minutesPerSession: 60,
  equipment: "Barbell, bumper plates and rack",
  constraints: "Travel on Fridays",
  priority: "A more consistent receiving position",
  targetDate: "2026-12-01",
};
export function liftingFixture(date: string): JournalState {
  const state = emptyJournal();
  state.profile.lifting = {
    ...liftingBrief,
    updatedAt: new Date().toISOString(),
  };
  const session = createWorkout(state, undefined, offsetDate(date, -1));
  session.title = "Snatch practice";
  session.athleteNotes = "The second set felt steadier. Ask me what changed.";
  const entry = createEntry(
    {
      ...days[0].exercises[0],
      exerciseId: "snatch",
      sets: 3,
      reps: "2",
      initialWeight: 40,
    },
    state,
    "open",
    session.date,
  );
  entry.sets = [
    { id: crypto.randomUUID(), weight: 40, reps: 2, result: "success", rpe: 6 },
    {
      id: crypto.randomUUID(),
      weight: 45,
      reps: 2,
      result: "",
      logged: true,
      rpe: 8,
    },
    { id: crypto.randomUUID(), weight: 50, reps: 0, result: "miss" },
    {
      id: crypto.randomUUID(),
      weight: 100,
      reps: 1,
      result: "",
      logged: false,
    },
  ];
  session.exercises = [entry];
  state.sessions.push(session);
  saveCheckin(state, { date: session.date, sleepHours: 7.5 }, date);
  state.activeWorkout = createWorkout(state, undefined, date);
  state.activeWorkout.title = "Next lifting session";
  return state;
}
