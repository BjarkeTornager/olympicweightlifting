import { isDeepStrictEqual } from "node:util";
import type { JournalState } from "../model";
import type { AgentAction } from "./action-schema";

// Entries on any of these dates, or with any of these ids.
function matching<T extends { date: string; id?: string }>(
  list: T[] | undefined,
  dates: (string | undefined)[],
  ids: string[] = [],
) {
  return (list ?? []).filter(
    (entry) =>
      dates.includes(entry.date) ||
      (entry.id !== undefined && ids.includes(entry.id)),
  );
}

// The part of the journal a logged change depends on: what the model read
// before asking for it, and what the change adds to or replaces. A change
// not listed here depends on the whole journal.
function scope(state: JournalState, action: AgentAction): unknown {
  switch (action.kind) {
    case "record_bundle":
      return action.entries.map((entry) => scope(state, entry));
    case "record_meal":
      return matching(state.nutrition.meals, [action.meal.date]);
    case "update_meal":
      return matching(
        state.nutrition.meals,
        [action.meal.date],
        [action.mealId],
      );
    case "repeat_meal":
      return [
        matching(state.nutrition.meals, [action.date], [action.mealId]),
        state.nutrition.favourites?.find((meal) => meal.id === action.mealId),
      ];
    case "log_drink":
      return matching(state.health.drinks, [action.drink.date]);
    case "log_supplement":
      return matching(state.health.supplements, [action.supplement.date]);
    case "record_body_fat":
      return matching(state.health.bodyFat, [action.bodyFat.date]);
    case "record_checkin":
      return matching(state.health.checkins, [action.checkin.date]);
    case "record_cardio":
      return matching(state.cardio.sessions, [action.cardio.date]);
    case "update_cardio":
      return matching(
        state.cardio.sessions,
        [action.changes.date],
        [action.cardioId],
      );
    case "record_session":
    case "update_session":
    case "log_workout_progress":
    case "log_sets":
    case "correct_workout_set":
    case "finish_workout":
    case "discard_workout":
      // The workout in progress and the history it joins or edits.
      return { activeWorkout: state.activeWorkout, sessions: state.sessions };
    default:
      return state;
  }
}

// Whether another save left alone everything this change depends on, so
// making it again on the newer journal gives what the model meant. If not
// (Health imported the run being logged, the meal being corrected was edited
// on the phone), making it again could log a duplicate or overwrite an edit.
export function unchangedFor(
  action: AgentAction,
  seen: JournalState,
  current: JournalState,
) {
  return isDeepStrictEqual(scope(seen, action), scope(current, action));
}
