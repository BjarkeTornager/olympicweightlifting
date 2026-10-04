import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  energyQuestionsFor,
  type BodyGoals,
} from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";
import { localClock } from "../lib/agent/time-context";
import {
  goalsConfirmId,
  goalsReadBack,
  voiceAction,
  voiceToolArgs,
} from "../lib/voice-actions";
import { voiceContext, voiceInstruction } from "../lib/voice-checkin";
import { elevenLabsTools } from "../lib/voice-elevenlabs";

// The voice coach's goal setup: feet, inches and pounds, and a plan read
// back before it is saved, with every safety note, the low-energy
// questions when due, and a yes that counts only for the plan heard.
const today = "2026-10-04";
type Goals = Omit<BodyGoals, "updatedAt">;
const lifter: Goals = {
  age: 28,
  sex: "male",
  heightCm: 178,
  weightKg: 84,
  targetWeightKg: 81,
  targetDate: null,
  activity: "moderate",
  trainingDays: 5,
  sessionMinutes: 90,
  experience: "experienced",
};

test("the voice coach passes feet, inches and pounds too, with the fields a model leaves empty", () => {
  const imperial = {
    age: 30,
    sex: "male" as const,
    heightFeet: 5,
    heightInches: 10,
    weightLb: 190,
    targetWeightLb: 180,
    targetDate: null,
    activity: "low" as const,
    trainingDays: 3,
  };
  const spoken = voiceAction(
    "set_goals",
    {
      ...imperial,
      summary: "5 foot 10, 190 pounds, down to 180",
      targetDate: "",
      heightCm: 0,
      weightKg: 0,
      targetWeightKg: 0,
    },
    emptyJournal(),
    today,
  );
  assert.ok(spoken.kind === "set_body_goals");
  assert.equal(spoken.bodyGoals.heightCm, 177.8);
  assert.equal(spoken.bodyGoals.weightKg, 86.2);
  // With no weight in either unit the call is refused, never guessed.
  assert.throws(() =>
    voiceAction(
      "set_goals",
      { ...imperial, summary: "Goals", weightLb: undefined },
      emptyJournal(),
      today,
    ),
  );
  // Both voice providers offer them, and none of height or weight is
  // required in one unit.
  const setGoals = elevenLabsTools().find(
    (t) => t.name === "set_goals",
  ) as unknown as {
    parameters: {
      properties: Record<string, { type: string }>;
      required: string[];
    };
  };
  assert.equal(setGoals.parameters.properties.heightFeet.type, "integer");
  assert.equal(setGoals.parameters.properties.weightLb.type, "number");
  assert.equal(setGoals.parameters.properties.energySigns.type, "boolean");
  assert.equal(setGoals.parameters.properties.weightClass.type, "boolean");
  assert.equal(setGoals.parameters.properties.confirm_id.type, "string");
  assert.ok(!setGoals.parameters.required.includes("heightCm"));
  assert.ok(!setGoals.parameters.required.includes("weightKg"));
});

test("by voice a deficit, a note or a changed answer is read back before saving, and saves only for the plan heard", () => {
  const state = emptyJournal();
  const goals = { ...lifter, sessionMinutes: 90 };
  const action = voiceAction(
    "set_goals",
    { ...goals, summary: "Down to 81", targetDate: "" },
    state,
    today,
  );
  assert.ok(action.kind === "set_body_goals");
  const prepared = prepareAction(state, action, today);
  const readBack = goalsReadBack(state, action.bodyGoals, prepared, today);
  assert.ok(readBack);
  assert.equal(readBack.saved, false);
  assert.match(readBack.plan, /^Lose about 0\.42 kg a week towards 81 kg/);
  assert.match(readBack.plan, /2,720 kcal a day/);
  assert.match(readBack.follow_up ?? "", /starting estimate; from 2026-10-25/);
  // The deficit asks the low-energy questions first.
  assert.deepEqual(readBack.ask_first, energyQuestionsFor("male"));
  assert.match(readBack.next, /Shall I save that\?/);
  // Its confirm_id saves exactly that plan; another plan's doesn't.
  assert.equal(
    readBack.confirm_id,
    goalsConfirmId(state, action.bodyGoals, today),
  );
  assert.equal(
    goalsReadBack(
      state,
      action.bodyGoals,
      prepared,
      today,
      readBack.confirm_id,
    ),
    null,
  );
  const other = prepareAction(
    state,
    {
      kind: "set_body_goals",
      bodyGoals: { ...action.bodyGoals, targetWeightKg: 80 },
    },
    today,
  );
  assert.ok(
    goalsReadBack(
      state,
      { ...action.bodyGoals, targetWeightKg: 80 },
      other,
      today,
      readBack.confirm_id,
    ),
  );
  // Answered no to all, the plan comes back without the questions, saying
  // first that it keeps the answer.
  const answered = { ...action.bodyGoals, energySigns: false };
  const second = goalsReadBack(
    state,
    answered,
    prepareAction(
      state,
      { kind: "set_body_goals", bodyGoals: answered },
      today,
    ),
    today,
  )!;
  assert.equal(second.ask_first, undefined);
  assert.deepEqual(second.changes, [
    "Saves that you answered no to the questions on stress fractures and eating.",
  ]);
  // A yes comes back held, with the note read in full.
  const yes = { ...action.bodyGoals, energySigns: true };
  const held = goalsReadBack(
    state,
    yes,
    prepareAction(state, { kind: "set_body_goals", bodyGoals: yes }, today),
    today,
  )!;
  assert.match(held.plan, /^Hold around 84 kg/);
  assert.match(held.safety_notes[0], /^You answered yes to one of/);
  assert.equal(held.follow_up, undefined);
  // A plan that holds with nothing to note saves at once.
  const steady = { ...action.bodyGoals, targetWeightKg: 84 };
  assert.equal(
    goalsReadBack(
      state,
      steady,
      prepareAction(
        state,
        { kind: "set_body_goals", bodyGoals: steady },
        today,
      ),
      today,
    ),
    null,
  );
  // But not one that would remove a saved answer unasked.
  const kidney = emptyJournal();
  applyGoals(kidney, { ...steady, limitProtein: true }, today);
  const removing = { ...steady, limitProtein: false };
  const removal = goalsReadBack(
    kidney,
    removing,
    prepareAction(
      kidney,
      { kind: "set_body_goals", bodyGoals: removing },
      today,
    ),
    today,
  )!;
  assert.match(removal.changes[0], /^Removes your answer about kidney disease/);
});

test("by voice a low goal weight is confirmed after the plan read back asks, then read back again", () => {
  // 60 kg at 178 cm is just under the healthy range.
  const low = { ...lifter, weightKg: 66, targetWeightKg: 58 };
  const state = emptyJournal();
  const first = voiceAction(
    "set_goals",
    { ...low, summary: "Down to 58", confirmLowWeight: true },
    state,
    today,
  );
  assert.ok(first.kind === "set_body_goals");
  // Sent before any plan asked, the confirmation doesn't count.
  assert.equal(first.bodyGoals.confirmLowWeight, undefined);
  const hold = prepareAction(state, first, today);
  const asked = goalsReadBack(state, first.bodyGoals, hold, today)!;
  assert.ok(
    asked.safety_notes.some((n) =>
      n.includes("confirm it and the plan will lose slowly"),
    ),
  );
  // With that plan's confirm_id, the athlete's yes reaches the plan, which
  // comes back to be read out again before it is saved.
  const confirmed = voiceAction(
    "set_goals",
    {
      ...low,
      summary: "Yes, I still want to",
      confirmLowWeight: true,
      confirm_id: asked.confirm_id,
    },
    state,
    today,
  );
  assert.ok(confirmed.kind === "set_body_goals");
  assert.equal(confirmed.bodyGoals.confirmLowWeight, true);
  const slow = prepareAction(state, confirmed, today);
  const again = goalsReadBack(
    state,
    confirmed.bodyGoals,
    slow,
    today,
    asked.confirm_id,
  )!;
  assert.ok(again);
  assert.ok(
    again.safety_notes.some((n) =>
      n.includes("As you've confirmed it, the plan loses slowly"),
    ),
  );
  // Its own confirm_id keeps the confirmation and saves.
  const final = voiceAction(
    "set_goals",
    {
      ...low,
      summary: "Yes, save it",
      confirmLowWeight: true,
      confirm_id: again.confirm_id,
    },
    state,
    today,
  );
  assert.ok(final.kind === "set_body_goals");
  assert.equal(final.bodyGoals.confirmLowWeight, true);
  assert.equal(
    goalsReadBack(
      state,
      final.bodyGoals,
      prepareAction(state, final, today),
      today,
      again.confirm_id,
    ),
    null,
  );
  // A made-up confirm_id counts for nothing.
  const made = voiceAction(
    "set_goals",
    { ...low, summary: "Yes", confirmLowWeight: true, confirm_id: "abc123" },
    state,
    today,
  );
  assert.ok(made.kind === "set_body_goals");
  assert.equal(made.bodyGoals.confirmLowWeight, undefined);
});

test("the voice coach is told to read the plan back, ask the questions and the weight class, and pass units as given", () => {
  const instruction = voiceInstruction(
    voiceContext(emptyJournal(), today),
    localClock(`${today}T09:00:00Z`, "UTC"),
    "Sam",
  );
  for (const words of [
    "ask whether it's a competition weight class and when the weigh-in is",
    "never convert them yourself",
    "It saves at once only a plan that holds their weight with nothing to note; any other comes back unsaved with a confirm_id.",
    "saying they're optional and kept only as a yes or no with the date so the plan stays safe, never as a diagnosis",
    "read out the calories and every one of its safety_notes in full, kindly",
    "Only after a yes, call set_goals again with the same details and that confirm_id.",
    "read the plan back as set_goals says, never leaving out a safety note",
  ])
    assert.ok(instruction.includes(words), words);
  assert.doesNotMatch(
    instruction,
    /in two short sentences, including any warning/,
  );
  // The arguments a model sends for "no answer" are none.
  const args = voiceToolArgs.set_goals.parse({
    ...lifter,
    summary: "Goals",
    energySigns: "",
    weightClass: null,
    confirm_id: "",
  });
  assert.equal(args.energySigns, undefined);
  assert.equal(args.weightClass, undefined);
  assert.equal(args.confirm_id, undefined);
  assert.equal(
    voiceToolArgs.set_goals.parse({
      ...lifter,
      summary: "Goals",
      energySigns: false,
    }).energySigns,
    false,
  );
});
