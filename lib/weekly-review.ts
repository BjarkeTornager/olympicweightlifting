import type { JournalState } from "./model";
import { foodDate, totalNutrients } from "./nutrition";
import { offsetDate } from "./health";

// Only explicit complete-day declarations enter nutrition averages. Zero and
// absent measurements remain distinct; dates are calendar dates, independent of DST.
export function weeklyReview(state: JournalState, endDate: string) {
  foodDate.parse(endDate);
  const period = (to: string) => {
    const from = offsetDate(to, -6);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = offsetDate(from, i);
      const meals = state.nutrition.meals.filter((m) => m.date === date);
      const checkin = state.health.checkins.find((c) => c.date === date);
      const strength = state.sessions.filter((s) => s.date === date);
      const cardio = state.cardio.sessions.filter((s) => s.date === date);
      return {
        date,
        meals,
        checkin: checkin ?? null,
        strength,
        cardio,
        foodComplete: Boolean(state.nutrition.completeDays?.includes(date)),
        nutrients: totalNutrients(meals.flatMap((m) => m.items)),
      };
    });
    const sleep = days.flatMap((d) =>
      d.checkin?.sleepHours == null ? [] : [d.checkin.sleepHours],
    );
    const complete = days.filter((d) => d.foodComplete);
    const average = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return {
      from,
      to,
      days,
      strengthSessions: days.reduce((n, d) => n + d.strength.length, 0),
      cardioSessions: days.reduce((n, d) => n + d.cardio.length, 0),
      sleepNights: sleep.length,
      averageSleepHours: average(sleep),
      foodLoggedDays: days.filter((d) => d.meals.length > 0).length,
      completeFoodDays: complete.length,
      averageCalories: average(complete.map((d) => d.nutrients.calories)),
      averageProtein: average(complete.map((d) => d.nutrients.protein)),
      estimatedCompleteDays: complete.filter((d) =>
        d.meals.some((m) => m.estimated),
      ).length,
    };
  };
  const current = period(endDate),
    previous = period(offsetDate(endDate, -7));
  const delta = (a: number | null, b: number | null) =>
    a == null || b == null ? null : a - b;
  return {
    current,
    previous,
    changes: {
      sleepHours: delta(current.averageSleepHours, previous.averageSleepHours),
      calories: delta(current.averageCalories, previous.averageCalories),
      strengthSessions: current.strengthSessions - previous.strengthSessions,
      cardioSessions: current.cardioSessions - previous.cardioSessions,
    },
    interpretation:
      "These are recorded entries, not a complete account of activity. Sleep averages use logged nights only. Food averages use days the person explicitly marked complete; portions may still be estimated. Different coverage limits comparisons. Changes do not establish causes or health outcomes.",
  };
}
