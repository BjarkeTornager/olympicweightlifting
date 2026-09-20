import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { systemPrompt } from "../lib/agent/knowledge";
import { coachStyle } from "../lib/agent/coach-style";

test("conversational prompt changes preserve the fixed health, privacy, evidence and action policy", () => {
  const prompt = systemPrompt("2026-09-07", "Europe/Copenhagen");
  assert.equal(prompt.split(coachStyle).length, 2);
  assert.equal(
    createHash("sha256")
      .update(prompt.replace(coachStyle, "<COACH_STYLE>"))
      .digest("hex"),
    // Multi-photo atomic saves, same-meal angles, retries and Undo are covered by
    // the 2026-09-20 coach-direct-log-database regression baseline.
    // Historical GEPA scores are not an evaluation of this policy revision.
    "b49c47a4b002f69d0d2317daf9273cc16e5ee22880da51cd565d74062998562c",
    "A fixed-policy change requires deliberate review and a fresh evaluation baseline.",
  );
  assert.ok(coachStyle.length >= 100 && coachStyle.length <= 4500);
});

test("Coach policy separates reported events, previews and advice", () => {
  const prompt = systemPrompt("2026-09-09", "Europe/Copenhagen", "09:30");
  assert.match(
    prompt,
    /Use log_entry for ordinary logging and requested corrections/,
  );
  assert.match(prompt, /Do not ask the person to press Save/);
  assert.match(
    prompt,
    /hypothetical examples, future intentions, third-party reports/,
  );
  assert.match(
    prompt,
    /Image upload\/classification alone never saves a journal entry/,
  );
  assert.match(
    prompt,
    /If the person says preview, prepare for review or do not save, respect that/,
  );
  assert.match(
    systemPrompt("2026-09-09", "Europe/Copenhagen", "09:30", false),
    /This client uses reviewed logging/,
  );
});
