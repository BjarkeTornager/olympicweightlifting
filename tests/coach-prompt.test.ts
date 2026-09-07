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
    "e57485d5041e8eb412b67de7876da48b506ebf42a48a2daef489fe573918c4c3",
    "A fixed-policy change requires deliberate review and a fresh evaluation baseline.",
  );
  assert.ok(coachStyle.length >= 100 && coachStyle.length <= 4500);
});
