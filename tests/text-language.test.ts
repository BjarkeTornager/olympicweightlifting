import { test } from "node:test";
import assert from "node:assert/strict";
import { danishOrNothing, writtenLanguage } from "../lib/text-language";

test("Danish replies and messages are marked Danish", () => {
  assert.equal(
    danishOrNothing(
      "Godt gået med søvnen i nat. Du har sovet syv en halv time og spist morgenmad og frokost, så der er overskud til en ordentlig træningssession.",
    ),
    "da",
  );
  assert.equal(danishOrNothing("Hvordan ser min dag ud?"), "da");
  assert.equal(danishOrNothing("Jeg spiste rugbrød"), "da");
});

test("English stays English, even when it names Danish food", () => {
  assert.equal(
    danishOrNothing("How should I approach training today?"),
    undefined,
  );
  assert.equal(
    danishOrNothing(
      "You logged rugbrød med æg og røget laks for lunch, which adds 535 kcal and 39 g protein to your day.",
    ),
    undefined,
  );
  assert.equal(
    danishOrNothing(
      "Today you logged rugbrød med leverpostej, frikadeller med kartofler og sovs, and æblekage.",
    ),
    undefined,
  );
  assert.equal(danishOrNothing("7 h 30 min · 80.2 kg"), undefined);
  assert.equal(danishOrNothing(""), undefined);
});

test("a short message's language is told by its words, not a dish's", () => {
  assert.equal(writtenLanguage("Jeg sov 7 timer"), "da");
  assert.equal(writtenLanguage("Spiste to æg og is"), "da");
  assert.equal(
    writtenLanguage("Lunch: rugbrød med leverpostej og agurk"),
    "en",
  );
  assert.equal(writtenLanguage("I slept 8 hours"), "en");
  // Words that don't tell: a lift, a dish on its own, a number.
  assert.equal(writtenLanguage("Bænkpres 80 kg 3x5"), undefined);
  assert.equal(writtenLanguage("rugbrød med leverpostej og agurk"), undefined);
  assert.equal(writtenLanguage("7 h 30 min"), undefined);
  assert.equal(writtenLanguage(""), undefined);
});
