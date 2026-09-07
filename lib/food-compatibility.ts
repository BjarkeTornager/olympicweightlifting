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
