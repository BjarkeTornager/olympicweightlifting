import type { JournalState } from "./model";
import { formatLitres, hydrationForDay } from "./hydration";

// A compact, complete picture of the journal for a date range, shared by
// both coaches: every entry with the ids needed to correct it.
export const dayRange = (from: string, to: string) => {
  if (to < from) throw Error("The end date is before the start date.");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 13)
    throw Error("Read at most 14 days at a time.");
  return (day: string) => day >= from && day <= to;
};

// What the voice coach sees of the journal: compact, with the ids it needs
// to correct an entry, and photo ids it can look at with view_photo.
export function journalForVoice(state: JournalState, from: string, to: string) {
  const inRange = dayRange(from, to);
  // Only what was actually done: planned exercises without sets are left out.
  const sets = (w: JournalState["sessions"][number]) =>
    w.exercises
      .map((e) => ({
        exercise: e.exerciseId,
        sets: e.sets
          .filter((x) => x.logged || x.result)
          .map((x) => ({
            weight_kg: x.weight,
            reps: x.reps,
            made: x.result !== "miss",
          })),
      }))
      .filter((e) => e.sets.length > 0);
  return {
    meals: state.nutrition.meals
      .filter((m) => inRange(m.date))
      .map((m) => ({
        meal_id: m.id,
        date: m.date,
        meal_type: m.type,
        name: m.name,
        photo_ids: m.photoIds,
        items: m.items.map((i) => ({
          name: i.name,
          portion: i.portion,
          calories: i.calories,
          protein_g: i.protein,
          carbs_g: i.carbs,
          fat_g: i.fat,
        })),
      })),
    workouts: state.sessions
      .filter((w) => inRange(w.date))
      .map((w) => ({
        session_id: w.id,
        date: w.date,
        title: w.title,
        exercises: sets(w),
      })),
    unfinishedWorkout: state.activeWorkout
      ? {
          date: state.activeWorkout.date,
          title: state.activeWorkout.title,
          exercises: sets(state.activeWorkout),
        }
      : null,
    checkins: state.health.checkins
      .filter((c) => inRange(c.date))
      .map((c) => ({
        date: c.date,
        sleep_hours: c.sleepHours,
        energy: c.energy,
        soreness: c.soreness,
        bodyweight: c.bodyweight,
        notes: c.notes,
      })),
    drinks: (state.health.drinks ?? [])
      .filter((d) => inRange(d.date))
      .map((d) => ({
        drink_id: d.id,
        date: d.date,
        ml: d.ml,
        kind: d.kind,
        name: d.name,
      })),
    activities: state.cardio.sessions
      .filter((c) => inRange(c.date))
      .map((c) => ({
        date: c.date,
        activity: c.activity,
        minutes: Math.round(c.durationSeconds / 60),
        distance_km: c.distanceKm,
      })),
    dailyTargets: state.nutrition.targets,
    goals: state.profile.body ?? null,
  };
}

// Today in full, with what has been eaten so far against the targets, so a
// coach never has to ask for what is already recorded.
export function dayForCoach(state: JournalState, date: string) {
  const day = journalForVoice(state, date, date);
  const eaten = day.meals.reduce(
    (t, m) => {
      for (const i of m.items) {
        t.calories += i.calories;
        t.protein_g += i.protein_g;
        t.carbs_g += i.carbs_g;
        t.fat_g += i.fat_g;
      }
      return t;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const round = (n: number) => Math.round(n);
  const water = hydrationForDay(state, date);
  return {
    date,
    ...day,
    hydration: {
      totalMl: water.totalMl,
      targetMl: water.targetMl,
      recorded: water.recorded,
    },
    eatenSoFar: {
      calories: round(eaten.calories),
      protein_g: round(eaten.protein_g),
      carbs_g: round(eaten.carbs_g),
      fat_g: round(eaten.fat_g),
      complete: state.nutrition.completeDays?.includes(date) ?? false,
    },
  };
}

// The day in one plain sentence per kind, for a quick spoken opening.
export function describeDay(day: ReturnType<typeof dayForCoach>) {
  const parts: string[] = [];
  for (const w of day.workouts)
    parts.push(
      `Training: ${w.title} (${w.exercises
        .map(
          (e) =>
            `${e.exercise.replace(/_/g, " ")} ${e.sets
              .map((x) => `${x.weight_kg}×${x.reps}${x.made ? "" : " missed"}`)
              .join(", ")}`,
        )
        .join("; ")})`,
    );
  for (const m of day.meals)
    parts.push(
      `${m.meal_type[0].toUpperCase()}${m.meal_type.slice(1)}: ${m.name} (${Math.round(m.items.reduce((t, i) => t + i.calories, 0))} kcal)`,
    );
  for (const c of day.checkins)
    if (c.sleep_hours != null) parts.push(`Sleep: ${c.sleep_hours} h`);
  if (day.hydration.recorded)
    parts.push(
      `Drinks: ${formatLitres(day.hydration.totalMl)} of about ${formatLitres(day.hydration.targetMl)}`,
    );
  for (const a of day.activities)
    parts.push(`Activity: ${a.activity}, ${a.minutes} min`);
  const target = day.dailyTargets.calories;
  if (day.meals.length)
    parts.push(
      `Eaten so far: ${day.eatenSoFar.calories} kcal, ${day.eatenSoFar.protein_g} g protein${target ? ` of ${target} kcal` : ""}`,
    );
  return parts.length ? parts.join(". ") + "." : "Nothing logged yet today.";
}
