import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  addSupplement,
  removeSupplement,
  supplementsForDay,
} from "../lib/supplements";
import { prepareAction } from "../lib/agent/actions";
import { loggingKinds } from "../lib/agent/action-schema";
import { voiceAction } from "../lib/voice-actions";
import { dayForCoach, describeDay } from "../lib/journal-summary";
import { buildToday } from "../lib/native-api";
import { journalSchema } from "../lib/model";

const date = "2026-09-28";

test("supplements are kept per day and can be removed", () => {
  const s = emptyJournal();
  const d = addSupplement(s, { date, name: " Vitamin D ", amount: "1000 IU" });
  addSupplement(s, { date, name: "Creatine" });
  assert.equal(d.name, "Vitamin D");
  assert.deepEqual(
    supplementsForDay(s, date).taken.map((x) => [x.name, x.amount]),
    [
      ["Vitamin D", "1000 IU"],
      ["Creatine", ""],
    ],
  );
  removeSupplement(s, d.id);
  assert.equal(supplementsForDay(s, date).taken.length, 1);
  assert.throws(() => removeSupplement(s, d.id), /not in your journal/);
  journalSchema.parse(s);
});

test("usual supplements are ones taken on two recent days, until taken today", () => {
  const s = emptyJournal();
  const at = (d: string) => new Date(`${d}T08:00:00Z`);
  addSupplement(
    s,
    { date: "2026-09-26", name: "Creatine", amount: "3 g" },
    at("2026-09-26"),
  );
  addSupplement(
    s,
    { date: "2026-09-27", name: "creatine", amount: "5 g" },
    at("2026-09-27"),
  );
  addSupplement(s, { date: "2026-09-27", name: "Iron" }, at("2026-09-27"));
  // Too long ago to count.
  addSupplement(s, { date: "2026-09-01", name: "Iron" }, at("2026-09-01"));
  assert.deepEqual(supplementsForDay(s, date).usual, [
    { name: "creatine", amount: "5 g" },
  ]);
  addSupplement(s, { date, name: "Creatine", amount: "5 g" });
  assert.deepEqual(supplementsForDay(s, date).usual, []);
});

test("Coach logs a supplement directly and removes one after review", () => {
  const s = emptyJournal();
  assert.ok(loggingKinds.includes("log_supplement"));
  const logged = prepareAction(
    s,
    {
      kind: "log_supplement",
      supplement: { date, name: "Fish oil", amount: "2 capsules" },
    },
    date,
  );
  assert.match(logged.detail, /Fish oil 2 capsules/);
  const id = logged.state.health.supplements![0].id;
  const removed = prepareAction(
    logged.state,
    { kind: "delete_supplement", supplementId: id },
    date,
  );
  assert.equal(removed.state.health.supplements!.length, 0);
  assert.throws(
    () =>
      prepareAction(
        s,
        {
          kind: "log_supplement",
          supplement: { date: "2026-09-29", name: "Zinc" },
        },
        date,
      ),
    /future/,
  );
});

test("the voice coach logs supplements with or without an amount", () => {
  const s = emptyJournal();
  assert.deepEqual(
    voiceAction(
      "log_supplement",
      { summary: "Vitamin D", date, name: "Vitamin D", amount: null },
      s,
      date,
    ),
    {
      kind: "log_supplement",
      supplement: { date, name: "Vitamin D", amount: "" },
    },
  );
});

test("both coaches and the iPhone app see today's supplements", () => {
  const s = emptyJournal();
  addSupplement(s, { date: "2026-09-26", name: "Magnesium" });
  addSupplement(s, { date: "2026-09-27", name: "Magnesium" });
  addSupplement(s, { date, name: "Vitamin D", amount: "1000 IU" });
  const day = dayForCoach(s, date);
  assert.deepEqual(
    day.supplements.map((x) => x.name),
    ["Vitamin D"],
  );
  assert.deepEqual(day.usualSupplementsNotYetTaken, ["Magnesium"]);
  assert.match(describeDay(day), /Supplements: Vitamin D 1000 IU/);
  const today = buildToday(s, 1, date, new Set());
  assert.equal(today.supplements?.taken[0].name, "Vitamin D");
  assert.deepEqual(today.supplements?.usual, [
    { name: "Magnesium", amount: "" },
  ]);
});
