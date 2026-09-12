import type { JournalState, Snapshot } from "./model";
/** Older cached food schemas reject unknown properties. Adapt only the response,
 * never the stored record; their writes preserve omitted tags in the transaction. */
export function foodSnapshotForClient<T extends Snapshot>(
  request: Request,
  snapshot: T,
): T {
  if (
    request.headers.get("x-coach-journal-version") !== "1" &&
    (snapshot.state.profile.coaching?.memories !== undefined ||
      snapshot.state.profile.coaching?.plans !== undefined ||
      snapshot.state.nutrition.favourites !== undefined ||
      snapshot.state.nutrition.completeDays !== undefined)
  ) {
    snapshot = structuredClone(snapshot);
    if (snapshot.state.profile.coaching) {
      delete snapshot.state.profile.coaching.memories;
      delete snapshot.state.profile.coaching.plans;
    }
    delete snapshot.state.nutrition.favourites;
    delete snapshot.state.nutrition.completeDays;
  }
  if (request.headers.get("x-food-tags-version") === "1") return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      nutrition: {
        ...snapshot.state.nutrition,
        meals: snapshot.state.nutrition.meals.map((meal) => ({
          ...meal,
          items: meal.items.map((item) => {
            const food = { ...item };
            delete food.classification;
            return food;
          }),
        })),
      },
    },
  };
}

/** A tag-aware manual undo explicitly clears tags that did not exist before.
 * Unversioned cached undo copies must not make that assertion. */
export function foodStateForUndo(state: JournalState): JournalState {
  return {
    ...state,
    nutrition: {
      ...state.nutrition,
      meals: state.nutrition.meals.map((meal) => ({
        ...meal,
        items: meal.items.map((item) => ({
          ...item,
          classification: item.classification ?? {
            foodGroups: [],
            ingredients: [],
          },
        })),
      })),
    },
  };
}

/** New manual undo snapshots can explicitly clear fields that did not exist.
 * Cached undo snapshots without a known Coach version cannot make that assertion. */
export function coachStateForUndo(state: JournalState): JournalState {
  const restored = structuredClone(state);
  restored.profile.coaching ??= { initiative: "gentle", focus: "" };
  restored.profile.coaching.memories ??= [];
  restored.profile.coaching.plans ??= [];
  restored.nutrition.favourites ??= [];
  restored.nutrition.completeDays ??= [];
  return restored;
}
export function hasCoachData(state: JournalState): boolean {
  return Boolean(
    state.profile.coaching?.memories?.length ||
    state.profile.coaching?.plans?.length ||
    state.nutrition.favourites?.length ||
    state.nutrition.completeDays?.length,
  );
}

/** Only a snapshot known to include lifting fields can assert their absence. */
export function liftingStateForUndo(state: JournalState): JournalState {
  return {
    ...state,
    profile: { ...state.profile, lifting: state.profile.lifting ?? null },
  };
}
