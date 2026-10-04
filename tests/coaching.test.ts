import { test } from "node:test";
import assert from "node:assert/strict";
import { backup, emptyJournal, parseLegacyBackup } from "../lib/domain";
import { journalSchema } from "../lib/model";
import {
  coachSuggestion,
  coachingContext,
  quietOpenings,
} from "../lib/coaching";
import { applyGoals } from "../lib/body-goals";
import { voiceContext } from "../lib/voice-checkin";
import { offsetDate, saveCheckin } from "../lib/health";
import { prepareAction } from "../lib/agent/actions";
import { mealSchema } from "../lib/nutrition";

const date = "2026-09-06";

test("dinner ideas use the meal tag and date without assuming intake, ingredients or preferences", () => {
  const state = emptyJournal();
  const meal = (type: string, day: string) =>
    mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date: day,
      name: "A logged meal",
      type,
      source: "text",
      estimated: true,
      notes: "",
      items: [
        {
          name: "Rice and vegetables",
          portion: "One bowl",
          calories: 400,
          protein: 8,
          carbs: 80,
          fat: 5,
        },
      ],
      photoIds: [],
    });
  state.nutrition.meals = [
    meal("dinner", date),
    meal("lunch", date),
    meal("dinner", offsetDate(date, -7)),
    meal("dinner", offsetDate(date, 1)),
  ];
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  state.nutrition.meals.push(meal("dinner", offsetDate(date, -6)));
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "dinner-ideas");
  assert.match(suggestion.observation, /2 dinners/);
  assert.doesNotMatch(
    suggestion.observation,
    /calories|enjoyed|rice|vegetarian/i,
  );
});

test("opening coaching never invents a gap, target or current recovery state", () => {
  const state = emptyJournal();
  const original = structuredClone(state);
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  assert.deepEqual(state, original);
  saveCheckin(
    state,
    { date: offsetDate(date, -1), energy: 1, soreness: 5 },
    date,
  );
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  saveCheckin(state, { date, energy: 2 }, date);
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "recovery");
  assert.match(suggestion.observation, /energy at 2\/5 today/);
  assert.doesNotMatch(suggestion.observation, /soreness/);
});

test("sleep observations require three consecutive recent nights and a separate logged baseline", () => {
  const state = emptyJournal();
  for (const offset of [-9, -8, -6, -3])
    saveCheckin(state, { date: offsetDate(date, offset), sleepHours: 8 }, date);
  for (const offset of [-2, 0])
    saveCheckin(
      state,
      { date: offsetDate(date, offset), sleepHours: 6.5 },
      date,
    );
  assert.equal(
    coachSuggestion(state, date).id,
    "get-to-know-you",
    "missing night is not zero",
  );
  saveCheckin(state, { date: offsetDate(date, -1), sleepHours: 6.5 }, date);
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "sleep-change");
  assert.match(suggestion.observation, /6 h 30 min/);
  assert.match(suggestion.observation, /across 4 logged nights/);
  assert.equal(
    coachSuggestion(state, offsetDate(date, 1)).id,
    "get-to-know-you",
    "stale nights cannot become a fresh trend",
  );
  saveCheckin(state, { date, energy: 1 }, date);
  assert.equal(
    coachSuggestion(state, date).id,
    "recovery",
    "current self-report takes precedence",
  );
});

// Nights at these offsets from `date`, reported by the athlete or imported
// from Apple Health with a source.
function nights(
  state: ReturnType<typeof emptyJournal>,
  offsets: number[],
  hours: number,
  source?: string,
) {
  for (const offset of offsets) {
    const checkin = saveCheckin(
      state,
      { date: offsetDate(date, offset), sleepHours: hours },
      date,
    );
    if (source !== undefined)
      checkin.sleepImport = {
        provider: "apple-health",
        digest: "a".repeat(64),
        start: "2026-09-01T22:00:00Z",
        end: "2026-09-02T05:00:00Z",
        importedAt: "2026-09-02T06:00:00Z",
        ...(source ? { source } : {}),
      };
  }
}
const fortnight = Array.from({ length: 14 }, (_, i) => -i);

test("a steady 6.0 h athlete gets the short-sleep opening, hidden for a week at a time", () => {
  const state = emptyJournal();
  nights(state, fortnight, 6);
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "sleep-short");
  assert.equal(suggestion.title, "Your nights have been on the short side.");
  assert.match(
    suggestion.observation,
    /14 logged nights from the last two weeks average 6 h, under the 7 hours or more most adults need/,
  );
  assert.doesNotMatch(suggestion.invitation, /GP/);
  assert.match(
    coachingContext(state, date).startingPoint!.observation,
    /average 6 h/,
  );
  // Hidden on a device, it stays away for seven days, then returns.
  const hidden = { "sleep-short": date, recovery: date };
  assert.deepEqual(quietOpenings(hidden, date), ["sleep-short"]);
  assert.deepEqual(quietOpenings(hidden, offsetDate(date, 6)), ["sleep-short"]);
  assert.deepEqual(quietOpenings(hidden, offsetDate(date, 7)), []);
  assert.deepEqual(quietOpenings(hidden, offsetDate(date, -1)), []);
  // Whatever else is in the device's storage is ignored.
  assert.deepEqual(
    quietOpenings({ "sleep-short": "1" } as Record<string, string>, date),
    [],
  );
  assert.deepEqual(
    quietOpenings(
      { "sleep-short": 5 } as unknown as Record<string, string>,
      date,
    ),
    [],
  );
  assert.equal(
    coachSuggestion(state, date, quietOpenings(hidden, date)).id,
    "get-to-know-you",
    "three short nights do not repeat a hidden note in other words",
  );
  saveCheckin(state, { date, energy: 2 }, date);
  assert.equal(coachSuggestion(state, date).id, "recovery");
});

test("short sleep needs five logged nights, and is firmer under 6 h and for teenagers", () => {
  const state = emptyJournal();
  nights(state, [-12, -9, -6, -2], 5);
  assert.notEqual(
    coachSuggestion(state, date).id,
    "sleep-short",
    "four nights are too few for an average",
  );
  nights(state, [-1], 5);
  const firm = coachSuggestion(state, date);
  assert.equal(firm.id, "sleep-short");
  assert.equal(firm.title, "Your sleep has been short for a while.");
  assert.match(firm.observation, /5 logged nights .* average 5 h, well under/);
  assert.match(firm.invitation, /seeing your GP/);
  // Old nights fall out of the two weeks.
  assert.equal(
    coachSuggestion(state, offsetDate(date, 3)).id,
    "get-to-know-you",
  );

  // 7.5 h is enough for an adult, or when the age is unknown, but not at 16.
  const teen = emptyJournal();
  nights(teen, fortnight, 7.5);
  assert.equal(coachSuggestion(teen, date).id, "get-to-know-you");
  teen.profile.age = 16;
  const short = coachSuggestion(teen, date);
  assert.equal(short.id, "sleep-short");
  assert.match(short.observation, /under the 8 to 10 hours recommended/);
  teen.profile.age = 30;
  assert.equal(coachSuggestion(teen, date).id, "get-to-know-you");
});

test("three nights under 6 h fire sleep-change on their own, with their own wording", () => {
  const state = emptyJournal();
  nights(state, [-2, -1, 0], 5.5);
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "sleep-change");
  assert.equal(suggestion.title, "Your last few nights were short.");
  assert.match(
    suggestion.observation,
    /last three nights \(2026-09-04–2026-09-06\) average 5 h 30 min\.$/,
  );
  nights(state, [-1], 6.5);
  nights(state, [0], 6);
  assert.equal(
    coachSuggestion(state, date).id,
    "get-to-know-you",
    "an average of exactly 6 h is not under it",
  );
});

test("mixed-source nights do not fire sleep-change", () => {
  // The week before as reported, the last three nights from an Apple Watch.
  const state = emptyJournal();
  nights(state, [-9, -8, -6, -3], 8);
  nights(state, [-2, -1, 0], 6.5, "Apple Watch");
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  // Three tracked nights that are not from one source neither.
  nights(state, [-9, -8, -6, -3], 8, "Apple Watch");
  nights(state, [-1], 6.5, "AutoSleep");
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  // From the same watch throughout, the drop shows.
  nights(state, [-1], 6.5, "Apple Watch");
  assert.equal(coachSuggestion(state, date).id, "sleep-change");
  // An import that did not name its source is its own source.
  nights(state, [-1], 6.5, "");
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
});

test("training follow-up includes cardio, uses the latest date and expires", () => {
  const prepared = prepareAction(
    emptyJournal(),
    {
      kind: "record_cardio",
      cardio: { activity: "running", date, durationSeconds: 1800 },
    },
    date,
  );
  const state = prepared.state;
  assert.equal(coachSuggestion(state, date).id, "training-follow-up");
  assert.match(coachSuggestion(state, date).observation, /today/);
  assert.match(
    coachSuggestion(state, offsetDate(date, 1)).observation,
    /2026-09-06/,
  );
  assert.equal(
    coachSuggestion(state, offsetDate(date, 3)).id,
    "get-to-know-you",
  );
  assert.equal(
    coachSuggestion(state, offsetDate(date, -1)).id,
    "get-to-know-you",
    "future records are not completed today",
  );
});

test("coaching preferences survive backups without changing legacy journals and gate unsolicited context", () => {
  const state = emptyJournal();
  assert.equal(
    Object.hasOwn(journalSchema.parse(state).profile, "coaching"),
    false,
  );
  state.profile.coaching = {
    initiative: "on-request",
    focus: "More energy for family life",
  };
  saveCheckin(state, { date, energy: 1 }, date);
  const restored = parseLegacyBackup(backup(state));
  assert.deepEqual(restored.profile.coaching, state.profile.coaching);
  assert.deepEqual(coachingContext(restored, date), {
    preferences: state.profile.coaching,
    age: null,
    approvedMemories: [],
    agreedPlans: [],
    startingPoint: null,
  });
  state.profile.coaching = {
    initiative: "gentle",
    focus: "Keep evenings relaxed",
  };
  assert.match(
    coachingContext(state, date).startingPoint!.observation,
    /energy at 1\/5/,
  );
  for (const coaching of [
    { initiative: "always", focus: "" },
    { initiative: "gentle", focus: "x".repeat(301) },
  ]) {
    assert.equal(
      journalSchema.safeParse({
        ...state,
        profile: { ...state.profile, coaching },
      }).success,
      false,
    );
  }
});

test("typed Coach gets the athlete's age from the goals, else Settings, as the voice coach does", () => {
  const state = emptyJournal();
  // Settings' 0 means unknown, so Coach asks before describing any amount.
  assert.equal(coachingContext(state, date).age, null);
  // A 16-year-old who entered their age in Settings but has no goals.
  state.profile.age = 16;
  assert.equal(state.profile.body, undefined);
  assert.equal(coachingContext(state, date).age, 16);
  assert.equal(coachingContext(state, date).goals, undefined);
  assert.equal(voiceContext(state, date).age, 16);
  applyGoals(
    state,
    {
      age: 34,
      sex: "female",
      heightCm: 168,
      weightKg: 64,
      targetWeightKg: 64,
      targetDate: null,
      activity: "moderate",
      trainingDays: 3,
      sessionMinutes: 60,
      experience: "developing",
    },
    date,
  );
  state.profile.age = 0;
  assert.equal(coachingContext(state, date).age, 34);
  assert.equal(voiceContext(state, date).age, 34);
});
