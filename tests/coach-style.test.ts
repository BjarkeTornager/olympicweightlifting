import { test } from "node:test";
import assert from "node:assert/strict";
import { coachStyle, withoutEmDashes } from "../lib/agent/coach-style";
import { fullPrompt, systemPrompt } from "../lib/agent/knowledge";

test("Coach writes like a coach texting, without em dashes", () => {
  assert.match(coachStyle, /coach texting the athlete/);
  assert.match(coachStyle, /Never use em dashes/);
  assert.ok(systemPrompt().includes(coachStyle));
});

test("em dashes that slip through become commas; ranges keep their en dash", () => {
  assert.equal(
    withoutEmDashes("Nice work — keep going."),
    "Nice work, keep going.",
  );
  assert.equal(withoutEmDashes("Rest—then squat."), "Rest, then squat.");
  assert.equal(withoutEmDashes("3–5 reps – easy"), "3–5 reps, easy");
  assert.equal(
    withoutEmDashes("Great session —, well done"),
    "Great session, well done",
  );
  assert.equal(withoutEmDashes("No dashes here."), "No dashes here.");
});

test("Coach's base instructions forbid em dashes and use none themselves", () => {
  assert.match(coachStyle, /Never use em dashes/);
  // Models copy the punctuation they're given.
  assert.ok(!fullPrompt().includes("—"), "the base prompt has no em dashes");
  assert.ok(!systemPrompt().includes("—"));
});
