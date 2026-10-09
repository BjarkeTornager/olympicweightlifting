import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import { addDrink } from "../lib/hydration";
import {
  applyJournalPatch,
  diffJournal,
  journalPatchSchema,
  PatchMismatch,
} from "../lib/journal-patch";
import { jsonEqual } from "../lib/json";

const now = new Date("2026-10-05T08:00:00Z");
function journal() {
  const state = emptyJournal();
  for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
    addDrink(state, { date, ml: 500, kind: "water" }, now);
    state.nutrition.meals.push({
      id: crypto.randomUUID(),
      date,
      name: `Oats ${date}`,
      type: "breakfast",
      items: [
        {
          name: "Oats",
          portion: "80 g",
          calories: 300,
          protein: 11,
          carbs: 54,
          fat: 5,
        },
      ],
      source: "text",
      estimated: true,
      notes: "",
      photoIds: [],
      createdAt: now.toISOString(),
    } as never);
    const w = createWorkout(state, days[0], date);
    w.finishedAt = `${date}T18:00:00.000Z`;
    state.sessions.push(w);
  }
  return state;
}
// Applying the changes to the first journal gives the second, as JSON.
const roundTrip = (before: object, after: object) => {
  const patch = journalPatchSchema.parse(
    JSON.parse(JSON.stringify(diffJournal(before, after))),
  );
  const applied = applyJournalPatch(structuredClone(before), patch);
  assert.ok(jsonEqual(applied, after), JSON.stringify(patch).slice(0, 400));
  return patch;
};

test("a small edit sends only the record it changes", () => {
  const before = journal();
  const after = structuredClone(before);
  after.nutrition.meals[1].notes = "with honey";
  const patch = roundTrip(before, after);
  assert.deepEqual(patch, [
    {
      op: "items",
      path: ["nutrition", "meals"],
      put: [after.nutrition.meals[1]],
    },
  ]);
  assert.ok(JSON.stringify(patch).length < 1000);
  assert.deepEqual(diffJournal(before, structuredClone(before)), []);
});

test("records are added, removed, edited and reordered; other values are set or cleared", () => {
  const before = journal();
  const after = structuredClone(before);
  after.nutrition.meals.splice(0, 1);
  addDrink(after, { date: "2026-10-04", ml: 330, kind: "coffee" }, now);
  after.sessions.reverse();
  after.sessions[0].exercises[0].sets[0].weight = "62.5";
  after.profile.bodyweight = 82.1;
  after.prs.snatch = 90;
  after.activeWorkout = createWorkout(after, days[1], "2026-10-05");
  delete (after.profile as Record<string, unknown>).unit;
  after.nutrition.completeDays = ["2026-10-01"];
  const patch = roundTrip(before, after);
  const sessions = patch.find(
    (p) => p.op === "items" && p.path.join(".") === "sessions",
  );
  assert.ok(sessions?.op === "items" && sessions.order?.length === 3);
  // Back again, and from and to an empty list.
  roundTrip(after, before);
  const empty = structuredClone(before);
  empty.sessions = [];
  empty.health.drinks = [];
  roundTrip(before, empty);
  roundTrip(empty, before);
});

test("random edits always round-trip", () => {
  let before = journal();
  for (let round = 0; round < 200; round++) {
    const after = structuredClone(before);
    const pick = <T>(list: T[]) =>
      list[(round * 7919) % Math.max(list.length, 1)];
    switch (round % 6) {
      case 0:
        addDrink(
          after,
          { date: "2026-10-04", ml: 100 + round, kind: "water" },
          now,
        );
        break;
      case 1:
        if (after.health.drinks?.length)
          after.health.drinks.splice(round % after.health.drinks.length, 1);
        break;
      case 2:
        if (after.sessions.length)
          pick(after.sessions).title = `Session ${round}`;
        break;
      case 3:
        after.sessions.sort(() => (round % 2 ? 1 : -1));
        break;
      case 4:
        after.profile.bodyweight = 70 + round / 10;
        break;
      case 5:
        if (after.nutrition.meals.length)
          pick(after.nutrition.meals).items.push({
            name: `Snack ${round}`,
            portion: "1",
            calories: round,
            protein: 1,
            carbs: 1,
            fat: 1,
          } as never);
        break;
    }
    roundTrip(before, after);
    before = after;
  }
});

test("changes made for another copy of the journal are refused, and paths stay in the journal", () => {
  const before = journal();
  const after = structuredClone(before);
  after.sessions.reverse();
  const patch = diffJournal(before, after);
  const other = journal();
  assert.throws(() => applyJournalPatch(other, patch), PatchMismatch);
  assert.throws(
    () =>
      applyJournalPatch(journal(), [
        { op: "set", path: ["missing", "x"], value: 1 },
      ]),
    PatchMismatch,
  );
  for (const bad of ["__proto__", "constructor", "prototype"])
    assert.equal(
      journalPatchSchema.safeParse([{ op: "set", path: [bad], value: {} }])
        .success,
      false,
    );
  assert.equal(
    journalPatchSchema.safeParse([{ op: "items", path: [], put: [] }]).success,
    false,
  );
});
