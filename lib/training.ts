import { isValidLoggedSet } from "../js/progression.js";
import { today, uid } from "./domain";
import { formatSleepDuration } from "./health";
import type { JournalState, Workout, WorkoutTemplate } from "./model";

export function formatSet(weight: string | number, reps: string | number) {
  return `${Number(weight) === 0 && weight !== "" ? "Bodyweight" : `${weight || "–"} kg`} × ${reps || "–"}`;
}
// The sets still to do in a review, counted, after the logged ones it lists
// set by set: "Planned: 3 × 12 at 10 kg, 1 × 8 (load to choose)".
export function plannedSetsText(sets: Workout["exercises"][number]["sets"]) {
  const groups: { weight: string; reps: string; count: number }[] = [];
  for (const s of sets.filter((s) => !isValidLoggedSet(s) && s.reps !== "")) {
    const [weight, reps] = [String(s.weight), String(s.reps)];
    const last = groups.at(-1);
    if (last?.weight === weight && last.reps === reps) last.count++;
    else groups.push({ weight, reps, count: 1 });
  }
  return groups.length
    ? `Planned: ${groups
        .map(
          (g) =>
            `${g.count} × ${g.reps}${
              g.weight === ""
                ? " (load to choose)"
                : Number(g.weight) === 0
                  ? " at bodyweight"
                  : ` at ${g.weight} kg`
            }`,
        )
        .join(", ")}`
    : "";
}
export function templateFromWorkout(
  workout: Workout,
  name = workout.title,
): WorkoutTemplate {
  return {
    id: uid(),
    name,
    exercises: workout.exercises
      .filter((e) => e.sets.length)
      .map((e) => ({
        exerciseId: e.exerciseId,
        sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
      })),
  };
}
export function startTemplate(
  template: WorkoutTemplate,
  date = today(),
): Workout {
  return {
    id: uid(),
    title: template.name,
    date,
    programId: "personal",
    programDayId: template.id,
    startedAt: new Date().toISOString(),
    recovery: "auto",
    athleteNotes: "",
    coachNotes: "",
    exercises: template.exercises.map(plannedEntry),
  };
}
// An exercise still to do, every set unlogged.
export function plannedEntry(
  exercise: WorkoutTemplate["exercises"][number],
): Workout["exercises"][number] {
  return {
    id: uid(),
    exerciseId: exercise.exerciseId,
    loggingVersion: 1,
    completed: false,
    athleteNotes: "",
    coachCue: "",
    prescribed: { targetSets: exercise.sets.length },
    sets: exercise.sets.map((s) => ({
      id: uid(),
      weight: s.weight,
      reps: s.reps,
      result: "",
      logged: false,
      touched: false,
    })),
  };
}
export function workoutTotals(workout: Workout) {
  const sets = workout.exercises
    .flatMap((e) => e.sets)
    .filter(isValidLoggedSet);
  const made = sets.filter((s) => s.result !== "miss");
  return {
    sets: sets.length,
    successfulSets: made.length,
    reps: made.reduce((n, s) => n + Number(s.reps), 0),
    volume: made.reduce((n, s) => n + Number(s.weight) * Number(s.reps), 0),
  };
}
export function trainingSummary(
  state: JournalState,
  from = "0000-01-01",
  to = today(),
  // One exercise, under every id it was logged as.
  exerciseIds?: readonly string[],
) {
  const sessions = state.sessions
    .filter((w) => w.date >= from && w.date <= to)
    .map((w) => ({
      ...w,
      exercises: w.exercises.filter(
        (e) => !exerciseIds || exerciseIds.includes(e.exerciseId),
      ),
    }))
    .filter((w) => w.exercises.length);
  const totals = sessions.reduce(
    (n, w) => {
      const t = workoutTotals(w);
      return {
        sets: n.sets + t.sets,
        reps: n.reps + t.reps,
        volume: n.volume + t.volume,
      };
    },
    { sets: 0, reps: 0, volume: 0 },
  );
  const records = new Map<
    string,
    { exerciseId: string; reps: number; weight: number; date: string }
  >();
  for (const w of sessions)
    for (const e of w.exercises)
      for (const s of e.sets) {
        if (!isValidLoggedSet(s) || s.result === "miss") continue;
        const key = `${e.exerciseId}:${Number(s.reps)}`;
        if (!records.has(key) || Number(s.weight) > records.get(key)!.weight)
          records.set(key, {
            exerciseId: e.exerciseId,
            reps: Number(s.reps),
            weight: Number(s.weight),
            date: w.date,
          });
      }
  return {
    from,
    to,
    sessions: sessions.length,
    ...totals,
    records: [...records.values()],
    recent: [...sessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5)
      .map((w) => ({
        id: w.id,
        title: w.title,
        date: w.date,
        ...workoutTotals(w),
        // For one exercise the sets answer "what did I lift", which the best
        // set per rep count leaves out.
        ...(exerciseIds
          ? {
              lifts: w.exercises.flatMap((e) =>
                e.sets.filter(isValidLoggedSet).map((s) => ({
                  weight: Number(s.weight),
                  reps: Number(s.reps),
                  ...(s.result ? { result: s.result } : {}),
                })),
              ),
            }
          : {}),
      })),
  };
}
export function weeklyVolume(state: JournalState) {
  const weeks = new Map<
    string,
    { week: string; volume: number; sets: number; sessions: number }
  >();
  for (const w of state.sessions) {
    if (w.date > today()) continue;
    const d = new Date(w.date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10),
      t = workoutTotals(w),
      row = weeks.get(key) ?? { week: key, volume: 0, sets: 0, sessions: 0 };
    row.volume += t.volume;
    row.sets += t.sets;
    row.sessions++;
    weeks.set(key, row);
  }
  return [...weeks.values()]
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, 12);
}
// Under 6 hours' sleep can lower performance, though little for morning
// sessions, so a short night before a workout suggests holding today's
// loads. It only suggests; the athlete decides.
export function shortSleepHint(state: JournalState, date: string) {
  const hours = state.health.checkins.find((c) => c.date === date)?.sleepHours;
  if (hours == null || hours >= 6) return undefined;
  return `You slept ${formatSleepDuration(hours)} before this session. Under 6 hours can lower performance, so you may want to hold today’s loads.`;
}
