import { test } from "node:test";
import assert from "node:assert/strict";
import { coachLines, linesLanguage, undoneReply } from "../lib/coach-lines";

test("Coach's own lines read naturally in English and Danish", () => {
  const en = coachLines("en"),
    da = coachLines("da");
  assert.deepEqual(Object.keys(da), Object.keys(en));
  assert.equal(coachLines(), en);
  assert.match(en.saved, /^Saved to your journal\./);
  assert.match(en.review, /^Ready for your review\./);
  assert.match(da.saved, /^Gemt i din journal\./);
  assert.match(da.review, /^Klar til gennemgang\./);
  assert.match(da.undone, /^Fortrudt\./);
  for (const line of [...Object.values(en), ...Object.values(da)])
    assert.doesNotMatch(line, /\u2014/, "no em dashes");
  for (const key of Object.keys(en) as (keyof typeof en)[])
    assert.notEqual(da[key], en[key], key);
});

test("the lines take the chosen language, or else the one the athlete and Coach write in", () => {
  assert.equal(linesLanguage("da", "I slept 8 hours"), "da");
  assert.equal(linesLanguage("en", "Jeg har sovet 8 timer i nat"), "en");
  // The website chooses none: Coach answers in the athlete's language.
  assert.equal(linesLanguage(undefined, "Jeg har sovet 8 timer i nat"), "da");
  assert.equal(linesLanguage(undefined, "I slept 8 hours last night"), "en");
  assert.equal(linesLanguage(undefined, ""), "en");
  assert.equal(linesLanguage(undefined), "en");
  // A photo sent without words: Coach's own answer decides.
  assert.equal(
    linesLanguage(undefined, "", "Det er en time mere, end du plejer at sove."),
    "da",
  );
});

test("undoing a save answers in the language of the receipt it replaces", () => {
  assert.equal(undoneReply(coachLines("da").saved), coachLines("da").undone);
  assert.equal(
    undoneReply(`${coachLines("da").saved}\n\nDu har sovet en time mere.`),
    coachLines("da").undone,
  );
  assert.equal(undoneReply(coachLines("en").saved), coachLines("en").undone);
  assert.equal(undoneReply(undefined), coachLines("en").undone);
});
