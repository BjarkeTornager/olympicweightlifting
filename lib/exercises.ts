import { EXERCISES } from "../js/public-data.js";
import type { JournalState } from "./model";
import { trainingPrograms } from "./training-programs";

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

// A word in the singular, so plurals compare with the catalogue's names:
// squats, presses, crunches and flies are squat, press, crunch and fly.
function singular(word: string) {
  if (word.length < 3 || /(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  return word.replace(/s$/, "");
}

/** All query words must match; equipment, muscle names and common aliases are searchable. */
export function searchExercises(query = "", filters: ExerciseFilters = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  // A plural also matches a word starting with its singular: "front squats"
  // finds the front squat, and "abs" still never matches "cable".
  const has = (text: string, word: string) =>
    text.includes(word) || ` ${text}`.includes(` ${singular(word)}`);
  const key = exerciseKey(query);
  const nameMatch = (exercise: (typeof EXERCISES)[number]) => {
    const names = [exercise.id, exercise.name, ...exercise.aliases];
    // A bench press should appear before exercises merely using dumbbells and a bench.
    return (
      words.reduce(
        (score, word) =>
          score + Number(names.some((name) => has(normalize(name), word))),
        0,
      ) +
      (words.length && names.some((name) => exerciseKey(name) === key)
        ? words.length + 1
        : 0)
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
    return words.every((word) => has(text, word));
  }).sort(
    (a, b) => nameMatch(b) - nameMatch(a) || a.name.localeCompare(b.name),
  );
}

export function exerciseLoggingNotes(id: string) {
  return EXERCISES.find((exercise) => exercise.id === id)?.loggingNotes ?? "";
}

// An exercise the catalogue lacks is the athlete's own, saved by its name
// in this namespace: custom:Standing cable reverse fly. It is private to
// their journal, never added to the shared catalogue.
const CUSTOM = "custom:";
const CUSTOM_NAME_MAX = 120;

// Characters a name never shows: format characters such as zero-width
// spaces and joiners, variation selectors, and the blank filler letters and
// braille blank that pass for a name while showing nothing.
const INVISIBLE =
  /[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u115F\u1160\u3164\uFFA0\u2800]/gu;

// How exercise names are compared, never shown: "Clean & jerk",
// "clean_and_jerk" and "custom:clean and jerk" share one key, and so do
// "Front squats" and "front squat", or "DB row" and "dumbbell row".
// Combining marks such as Hindi or Thai vowel signs belong to their letter,
// so they still tell two names apart.
export const exerciseKey = (value: string) =>
  value
    .normalize("NFC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(/^(custom:)+/, "")
    .replaceAll("&", " and ")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => (word === "db" ? "dumbbell" : singular(word)))
    .join(" ");

// The name of the athlete's own exercise as it is saved: one line of single
// spaces without invisible characters, a capital first letter and the rest
// as typed ("RDL", "EZ-bar"). Refused rather than cut when it has no letter
// or number to show, or is too long, so two long names never become one.
export function canonicalCustomName(raw: string) {
  const name = raw
    .normalize("NFC")
    .replace(/\s/gu, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(INVISIBLE, "")
    .replace(/ +/g, " ")
    .trim()
    .replace(/^(custom: *)+/i, "");
  const [first = "", ...rest] = name;
  const canonical = first.toUpperCase() + rest.join("");
  if (!/[\p{L}\p{N}]/u.test(canonical))
    throw Error(
      "Give the exercise a name, such as custom:Standing cable reverse fly.",
    );
  if (canonical.length > CUSTOM_NAME_MAX)
    throw Error(
      `An exercise name can be at most ${CUSTOM_NAME_MAX} characters. Use a shorter name.`,
    );
  return canonical;
}
export const customExerciseId = (name: string) =>
  CUSTOM + canonicalCustomName(name);

// The athlete's own exercise ids, most relevant first: the workout in
// progress, history from the newest, routines, then programmes.
export function customExerciseIds(state: JournalState) {
  const sessions = [...state.sessions].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const ids = [
    ...(state.activeWorkout?.exercises ?? []),
    ...sessions.flatMap((w) => w.exercises),
    ...state.templates.flatMap((t) => t.exercises),
    ...trainingPrograms(state).flatMap((p) =>
      p.days.flatMap((d) => d.exercises),
    ),
  ].map((e) => e.exerciseId);
  return [...new Set(ids.filter((id) => id.startsWith(CUSTOM)))];
}

// Catalogue ids by the key of each id, name and alias. "Overhead press" is
// an alias of two lifts, so it names neither on its own. A placeholder for
// a group of movements in the built-in programme has no muscles, and its id
// is no exercise's name: upper_back is "Rows / pull-ups".
const catalogueKeys = new Map<string, string[]>();
for (const e of EXERCISES)
  for (const name of [
    ...(e.muscles.length ? [e.id] : []),
    e.name,
    ...e.aliases,
  ]) {
    const ids = catalogueKeys.get(exerciseKey(name)) ?? [];
    if (!ids.includes(e.id))
      catalogueKeys.set(exerciseKey(name), [...ids, e.id]);
  }
// Catalogue exercises with exactly this name, id or alias: a whole match,
// never a near one, so a standing cable reverse fly is not the dumbbell
// reverse fly.
export const catalogueMatches = (name: string) =>
  catalogueKeys.get(exerciseKey(name)) ?? [];

// The id a journal change saves for each exercise it names, given the ids
// of the record it changes (the workout in progress, or the session,
// routine or programme being edited). A catalogue id stays. The record's
// own spelling of the exercise stays, so its sets join that entry and its
// notes and targets carry on. Any id the journal already holds stays as it
// is. custom:Back squat is back_squat. Another spelling of an exercise the
// athlete already has is the id they already use, exactly as stored.
// Anything else named custom: becomes a new canonical id, the same for every
// spelling within one change. Other ids pass through, for validation to
// refuse. Resolving a resolved id changes nothing.
export function exerciseResolver(state: JournalState) {
  let stored: string[] | undefined;
  let own: Map<string, string> | undefined;
  return (id: string, record: readonly string[] = []) => {
    if (!id.startsWith(CUSTOM) || EXERCISES.some((e) => e.id === id)) return id;
    const key = exerciseKey(id);
    const here = record.filter(
      (r) => key && r.startsWith(CUSTOM) && exerciseKey(r) === key,
    );
    if (here.length) return here.includes(id) ? id : here[0];
    stored ??= customExerciseIds(state);
    if (stored.includes(id)) return id;
    const name = canonicalCustomName(id.slice(CUSTOM.length));
    const known = catalogueMatches(name);
    if (known.length === 1) return known[0];
    if (!own) {
      own = new Map();
      for (const s of stored)
        if (!own.has(exerciseKey(s))) own.set(exerciseKey(s), s);
    }
    if (!own.has(exerciseKey(name))) own.set(exerciseKey(name), CUSTOM + name);
    return own.get(exerciseKey(name))!;
  };
}
export const resolveExerciseId = (
  state: JournalState,
  id: string,
  record?: readonly string[],
) => exerciseResolver(state)(id, record);

// Rest between sets, a coaching default rather than a rule: trained lifters
// may need more than 2 minutes to lift their heaviest (ACSM: 2-3 minutes for
// heavy core lifts), and size gains little beyond 90 seconds. So 3 minutes
// for the competition lifts and their variants, squats and pulls, 2 for
// other barbell work and 90 seconds for accessories.
const longRest = new Set([
  "Snatch",
  "Clean",
  "Competition",
  "Jerk",
  "Overhead",
  "Strength",
]);
export function defaultRestSeconds(exerciseId: string) {
  const exercise = EXERCISES.find((e) => e.id === exerciseId);
  if (!exercise) return 90;
  if (longRest.has(exercise.category) || exercise.id === "deadlift") return 180;
  return exercise.equipment[0] === "Barbell" ? 120 : 90;
}

// The rest timer's start: a programme's own rest for the exercise, then the
// athlete's chosen default, then the default for the exercise type.
export function restSeconds(
  entry: { exerciseId: string; prescribed?: Record<string, unknown> },
  preference?: number,
) {
  const planned = Number(entry.prescribed?.restSeconds);
  if (Number.isInteger(planned) && planned > 0) return planned;
  return preference ?? defaultRestSeconds(entry.exerciseId);
}
