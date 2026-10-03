import { test } from "node:test";
import assert from "node:assert/strict";
import { danishOrNothing } from "../lib/text-language";

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
