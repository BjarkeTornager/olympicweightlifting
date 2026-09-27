import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { journalSchema } from "../lib/model";
import { scenarios } from "../scripts/coach-bench/scenarios";
import { dates, seedMeal } from "../scripts/coach-bench/bench";

const seeded = (seed?: (s: ReturnType<typeof emptyJournal>) => void) => {
  const state = emptyJournal();
  seed?.(state);
  return journalSchema.parse(state);
};

test("the hard benchmark's scenarios are well formed", () => {
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  for (const s of scenarios) {
    assert.doesNotThrow(() => seeded(s.seed), `${s.id}: seed is invalid`);
    for (const t of s.turns) {
      assert.ok(t.en.trim() && t.da.trim(), `${s.id}: both languages`);
      assert.notEqual(t.en, t.da, `${s.id}: Danish is translated`);
    }
  }
  const splits = new Set(scenarios.map((s) => s.split));
  assert.deepEqual([...splits].sort(), ["heldout", "train", "validation"]);
});

test("the checks aren't vacuous: doing nothing fails a save, saving something unasked fails the rest", () => {
  for (const s of scenarios)
    for (const [i, t] of s.turns.entries()) {
      const before = seeded(s.seed);
      const context = { before, reply: "", proposals: [], tools: [] };
      if (t.expects === "save")
        assert.ok(
          t.check({ ...context, after: structuredClone(before) }).length > 0,
          `${s.id} turn ${i + 1}: passes when nothing is saved`,
        );
      else {
        const after = structuredClone(before);
        seedMeal(after, {
          date: dates.today,
          type: "snack",
          name: "Unrequested snack",
          items: [
            {
              name: "Biscuit",
              portion: "1",
              calories: 80,
              protein: 1,
              carbs: 10,
              fat: 4,
            },
          ],
        });
        assert.ok(
          t.check({ ...context, after }).length > 0,
          `${s.id} turn ${i + 1}: passes when something unasked is saved`,
        );
      }
    }
});
