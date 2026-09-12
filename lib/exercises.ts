import { EXERCISES } from "../js/public-data.js";

export type ExerciseFilters = {
  discipline?: string;
  muscle?: string;
  equipment?: string;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\bdb\b/g, "dumbbell")
    .replace(/[_\W]+/g, " ")
    .trim();
}

export const exerciseMuscles = [
  ...new Set(EXERCISES.flatMap((e) => e.muscles)),
].sort();
export const exerciseEquipment = [
  ...new Set(EXERCISES.flatMap((e) => e.equipment)),
].sort();

/** All query words must match; equipment, muscle names and common aliases are searchable. */
export function searchExercises(query = "", filters: ExerciseFilters = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const nameMatch = (exercise: (typeof EXERCISES)[number]) => {
    const names = [exercise.id, exercise.name, ...exercise.aliases].map(
      normalize,
    );
    // A bench press should appear before exercises merely using dumbbells and a bench.
    return (
      words.reduce(
        (score, word) =>
          score + Number(names.some((name) => name.includes(word))),
        0,
      ) +
      (words.length && names.includes(normalize(query)) ? words.length + 1 : 0)
    );
  };
  return EXERCISES.filter((exercise) => {
    if (
      filters.discipline &&
      filters.discipline !== "all" &&
      !exercise.disciplines.includes(filters.discipline)
    )
      return false;
    if (
      filters.muscle &&
      filters.muscle !== "all" &&
      !exercise.muscles.some((muscle) => muscle === filters.muscle)
    )
      return false;
    if (
      filters.equipment &&
      filters.equipment !== "all" &&
      !exercise.equipment.some((equipment) => equipment === filters.equipment)
    )
      return false;
    const text = normalize(
      [
        exercise.id,
        exercise.name,
        exercise.category,
        ...exercise.aliases,
        ...exercise.muscles,
        ...exercise.equipment,
      ].join(" "),
    );
    return words.every((word) => text.includes(word));
  }).sort(
    (a, b) => nameMatch(b) - nameMatch(a) || a.name.localeCompare(b.name),
  );
}

export function exerciseLoggingNotes(id: string) {
  return EXERCISES.find((exercise) => exercise.id === id)?.loggingNotes ?? "";
}
