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
    "a5ce9a107e6da3f008edd6db308e7535ce88e596b0bc2fca8c62ae4fafd5bd4a",
    "A fixed-policy change requires deliberate review and a fresh evaluation baseline.",
  );
  assert.ok(coachStyle.length >= 100 && coachStyle.length <= 4500);
});
