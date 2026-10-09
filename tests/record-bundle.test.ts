import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { prepareAction } from "../lib/agent/actions";
import { BUNDLE_MAX } from "../lib/agent/action-schema";
import { supplementsForDay } from "../lib/supplements";

const date = "2026-10-05";
const item = (name: string, portion: string, calories: number) => ({
  name,
  portion,
  calories,
  protein: 5,
  carbs: 10,
  fat: 3,
});
// One message from the owner: food, two drinks and five supplements, which
// a save of six entries could not hold.
const day = [
  {
    kind: "record_meal",
    meal: {
      date,
      type: "breakfast",
      name: "Rye bread, eggs, banana and raisins",
      items: [
        item("Raisins", "1 handful", 85),
        item("Rye bread", "5 slices", 400),
        item("Fried eggs", "5 eggs", 450),
        item("Banana", "1", 105),
      ],
      source: "text",
      estimated: true,
    },
  },
  { kind: "log_drink", drink: { date, ml: 500, kind: "water" } },
  {
    kind: "log_drink",
    drink: { date, ml: 250, kind: "other", name: "Kefir" },
  },
  ...[
    ["Omega 3", "4"],
    ["Multivitamin", "2"],
    ["Magnesium", "1"],
    ["Q10", "1"],
    ["Creatine", "6800 mg"],
  ].map(([name, amount]) => ({
    kind: "log_supplement",
    supplement: { date, name, amount },
  })),
];

test("one save holds a whole reported day: food, drinks and every supplement", () => {
  const prepared = prepareAction(
    emptyJournal(),
    { kind: "record_bundle", entries: day },
    date,
  );
  assert.equal(prepared.entries?.length, 8);
  assert.equal(prepared.title, "Review 8 entries");
  assert.equal(prepared.state.nutrition.meals.length, 1);
  assert.equal(prepared.state.health.drinks?.length, 2);
  assert.deepEqual(
    supplementsForDay(prepared.state, date).taken.map((s) => [
      s.name,
      s.amount,
    ]),
    [
      ["Omega 3", "4"],
      ["Multivitamin", "2"],
      ["Magnesium", "1"],
      ["Q10", "1"],
      ["Creatine", "6800 mg"],
    ],
  );
});

test(`a save holds up to ${BUNDLE_MAX} entries`, () => {
  const drinks = (n: number) =>
    Array.from({ length: n }, () => ({
      kind: "log_drink",
      drink: { date, ml: 100, kind: "water" },
    }));
  const full = prepareAction(
    emptyJournal(),
    { kind: "record_bundle", entries: drinks(BUNDLE_MAX) },
    date,
  );
  assert.equal(full.state.health.drinks?.length, BUNDLE_MAX);
  assert.throws(() =>
    prepareAction(
      emptyJournal(),
      { kind: "record_bundle", entries: drinks(BUNDLE_MAX + 1) },
      date,
    ),
  );
});
