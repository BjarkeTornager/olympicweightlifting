import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldResumeMealLogging } from "../lib/agent/meal-logging";

const gate =
  "I still need two details before saving: Did you eat the whole tray, and was the grilled meat chicken, pork, or another meat?";

test("a portion clarification gets one recovery opportunity for explicit consumption reports", () => {
  for (const text of [
    "Also eat 3 fried eggs",
    "I ate lunch",
    "I just drank coffee",
    "Log the food I ate in this image now",
    "For lunch I had eggs",
  ]) {
    assert.equal(shouldResumeMealLogging(text, gate), true, text);
  }
  assert.equal(
    shouldResumeMealLogging(
      "Also eat 3 fried eggs",
      "Saved your lunch with an estimated serving of meat. Correct the portion whenever you like.",
    ),
    false,
  );
});

test("meal recovery never upgrades advice, previews, future plans or status questions into reports", () => {
  for (const text of [
    "What did I eat today?",
    "Show my meal photos",
    "How much protein is in eggs?",
    "I ate eggs, but don't save anything",
    "I ate eggs; preview the entry only",
    "I might eat eggs",
    "Also eat 3 fried eggs tomorrow",
    "Log my friend's meal",
    "Log my partner's lunch",
    "For example, I ate eggs",
    "Can I eat eggs?",
    "I ate eggs, just asking about protein",
    'Coach said "I ate eggs"',
  ]) {
    assert.equal(shouldResumeMealLogging(text, gate), false, text);
  }
});
