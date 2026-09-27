// The hard Coach benchmark: types, the fixed clock, journal seeds and the
// checks scenarios use. Offline tooling, never imported by the app.
import type { ActionPreview } from "../../lib/agent/actions";
import { mealSchema } from "../../lib/nutrition";
import { saveCheckin } from "../../lib/health";
import { saveCardio } from "../../lib/cardio";
import { addDrink, hydrationForDay } from "../../lib/hydration";
import type { JournalState } from "../../lib/model";

// Thursday 24 September 2026, 19:30 in Copenhagen. Fixed so "yesterday" and
// "last Tuesday" always mean the same dates.
export const BENCH_NOW = "2026-09-24T17:30:00Z";
export const TIMEZONE = "Europe/Copenhagen";
export const dates = {
  today: "2026-09-24",
  yesterday: "2026-09-23",
  twoDaysAgo: "2026-09-22",
  lastTuesday: "2026-09-22",
};

export type Language = "en" | "da";
export type Split = "train" | "validation" | "heldout";
export type Category =
  | "strength"
  | "meals"
  | "several"
  | "dates"
  | "corrections"
  | "units"
  | "restraint"
  | "routines";

export type TurnContext = {
  before: JournalState;
  after: JournalState;
  reply: string;
  proposals: ActionPreview[];
  tools: { name: string; ok: boolean }[];
};
export type Turn = {
  en: string;
  da: string;
  // Local time the message is sent (HH:MM on the benchmark day); default 19:30.
  at?: string;
  // What a correct turn does, for the do-nothing sanity test: save it, only
  // prepare a review, or leave the journal alone.
  expects: "save" | "review" | "no-change";
  // Failure messages; empty when the turn is right.
  check: (c: TurnContext) => string[];
};
export type Scenario = {
  id: string;
  title: string;
  category: Category;
  split: Split;
  seed?: (state: JournalState) => void;
  turns: Turn[];
};

// ---- Seeds ----------------------------------------------------------------

const createdAt = BENCH_NOW;
type Item = {
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};
export function seedMeal(
  state: JournalState,
  meal: {
    date: string;
    type: "breakfast" | "lunch" | "dinner" | "snack";
    name: string;
    items: Item[];
    notes?: string;
  },
) {
  const saved = mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt,
    source: "manual",
    estimated: false,
    photoIds: [],
    notes: "",
    ...meal,
  });
  state.nutrition.meals.push(saved);
  return saved;
}
export const seedCheckin = (
  state: JournalState,
  checkin: { date: string } & Record<string, unknown>,
) => saveCheckin(state, checkin, dates.today);
export const seedCardio = (
  state: JournalState,
  cardio: { date: string; activity: string; durationSeconds: number } & Record<
    string,
    unknown
  >,
) => saveCardio(state, cardio, dates.today);
export const seedDrink = (state: JournalState, date: string, ml: number) =>
  addDrink(state, { date, ml, kind: "water" }, new Date(BENCH_NOW));

type SetSpec = [weight: number, reps: number, made?: boolean];
export function workout(
  date: string,
  exercises: Record<string, SetSpec[]>,
  title = "Training",
) {
  return {
    id: crypto.randomUUID(),
    title,
    date,
    programId: "open",
    programDayId: "open",
    startedAt: BENCH_NOW,
    recovery: "auto" as const,
    athleteNotes: "",
    coachNotes: "",
    exercises: Object.entries(exercises).map(([exerciseId, sets]) => ({
      id: crypto.randomUUID(),
      exerciseId,
      athleteNotes: "",
      coachCue: "",
      prescribed: {},
      sets: sets.map(([weight, reps, made = true]) => ({
        id: crypto.randomUUID(),
        weight: String(weight),
        reps: String(reps),
        rpe: "",
        result: made ? ("success" as const) : ("miss" as const),
        logged: true,
      })),
    })),
  };
}

// ---- Reading the journal --------------------------------------------------

export type LoggedSet = [weight: number, reps: number, made: boolean];
const logged = (w: JournalState["sessions"][number], exercise: string) =>
  w.exercises
    .filter((e) => e.exerciseId === exercise)
    .flatMap((e) =>
      e.sets
        .filter((s) => s.logged || s.result)
        .map((s): LoggedSet => [
          Number(s.weight),
          Number(s.reps),
          s.result !== "miss",
        ]),
    );
export const activeSets = (state: JournalState, exercise: string) =>
  state.activeWorkout ? logged(state.activeWorkout, exercise) : [];
export const sessionSets = (
  state: JournalState,
  date: string,
  exercise: string,
) =>
  state.sessions
    .filter((w) => w.date === date)
    .flatMap((w) => logged(w, exercise));
export const checkinOn = (state: JournalState, date: string) =>
  state.health.checkins.find((c) => c.date === date);
export const mealsOn = (state: JournalState, date: string, type?: string) =>
  state.nutrition.meals.filter(
    (m) => m.date === date && (!type || m.type === type),
  );
export const total = (
  meals: { items: Item[] }[],
  key: "calories" | "protein" = "calories",
) => meals.reduce((n, m) => n + m.items.reduce((t, i) => t + i[key], 0), 0);
export const cardioOn = (
  state: JournalState,
  date: string,
  activity?: string,
) =>
  state.cardio.sessions.filter(
    (c) => c.date === date && (!activity || c.activity === activity),
  );
export const water = (state: JournalState, date: string) =>
  hydrationForDay(state, date).totalMl;
export const bodyFatOn = (state: JournalState, date: string) =>
  (state.health.bodyFat ?? []).filter((b) => b.date === date);

// ---- Checks ----------------------------------------------------------------

export const near = (a: unknown, b: number, tolerance = 0.01) =>
  typeof a === "number" && Math.abs(a - b) <= tolerance;
export function expect(ok: boolean, message: string) {
  return ok ? [] : [message];
}
export function sameSets(
  label: string,
  actual: LoggedSet[],
  expected: LoggedSet[],
  tolerance = 0.01,
) {
  const ok =
    actual.length === expected.length &&
    actual.every(
      (s, i) =>
        Math.abs(s[0] - expected[i][0]) <= tolerance &&
        s[1] === expected[i][1] &&
        s[2] === expected[i][2],
    );
  return ok
    ? []
    : [
        `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ];
}
const domains = [
  "activeWorkout",
  "sessions",
  "health",
  "cardio",
  "nutrition",
  "profile",
  "prs",
  "program",
  "templates",
  "preferences",
] as const;
export type Domain = (typeof domains)[number];
// Everything outside `allowed` must be exactly as before.
export function onlyChanged(c: TurnContext, allowed: Domain[] = []): string[] {
  return domains
    .filter(
      (d) =>
        !allowed.includes(d) &&
        JSON.stringify(c.before[d]) !== JSON.stringify(c.after[d]),
    )
    .map((d) => `Unexpected change: ${d}`);
}
export const pendingReview = (c: TurnContext) =>
  c.proposals.some((p) => !p.status);
export const mentions = (reply: string, pattern: RegExp) =>
  pattern.test(reply.replace(/ /g, " "));
