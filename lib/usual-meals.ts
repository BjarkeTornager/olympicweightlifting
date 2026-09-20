import type { FavouriteMeal, Meal } from "./nutrition";

export function usualMeals(
  meals: Meal[],
  favourites: FavouriteMeal[],
  hour: number,
  date: string,
) {
  const type = hour < 11 ? "breakfast" : hour < 16 ? "lunch" : "dinner";
  const past = meals.filter((meal) => meal.date <= date);
  const candidates: (Meal | FavouriteMeal)[] = [
    ...favourites,
    ...[...past].reverse(),
  ];
  const frequency = (name: string) =>
    past.filter((m) => m.name.toLowerCase() === name.toLowerCase()).length;
  return candidates
    .filter(
      (meal, index) =>
        candidates.findIndex(
          (m) =>
            m.name.toLowerCase() === meal.name.toLowerCase() &&
            m.type === meal.type,
        ) === index,
    )
    .map((meal, index) => ({
      meal,
      index,
      score:
        (meal.type === type ? 1000 : 0) +
        (favourites.some((f) => f.id === meal.id) ? 100 : 0) +
        Math.min(30, frequency(meal.name)),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(({ meal }) => meal);
}
