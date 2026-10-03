import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coachLines,
  earlierWords,
  linesLanguage,
  undoneReply,
} from "../lib/coach-lines";

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

test("an English log that names a Danish dish keeps English lines", () => {
  for (const log of [
    "Lunch: rugbrød med leverpostej og agurk",
    "Breakfast: havregryn med mælk og banan",
    "Had rugbrød med leverpostej og frikadeller",
    "Ate frikadeller med kartofler og sovs",
  ])
    assert.equal(linesLanguage(undefined, log), "en", log);
  // Even after a Danish conversation: the message's own words come first.
  assert.equal(
    linesLanguage(
      undefined,
      "Lunch: rugbrød med leverpostej og agurk",
      "Jeg har sovet 8 timer i nat",
    ),
    "en",
  );
  // Danish words around the dish make it Danish.
  assert.equal(
    linesLanguage(undefined, "Jeg spiste rugbrød med leverpostej og agurk"),
    "da",
  );
  assert.equal(linesLanguage(undefined, "Jeg sov 7 timer"), "da");
});

test("a log whose words don't tell takes the conversation's language", () => {
  const danish = earlierWords([
    {
      question: "Hvordan har jeg sovet i denne uge?",
      reply: "Du har sovet 7 timer i snit, en time mere end ugen før.",
      status: "done",
    },
    // A receipt alone and a refused turn say nothing of their own.
    {
      question: "Bænkpres 80 kg 3x5",
      reply: coachLines("en").saved,
      status: "done",
    },
    { question: "Sov 7 timer", reply: "Coach is paused", status: "limited" },
  ]);
  for (const log of [
    "Sov 7 timer i nat",
    "Bænkpres 80 kg 3x5",
    "rugbrød med leverpostej",
    "",
  ])
    assert.equal(linesLanguage(undefined, log, ...danish), "da", log);
  const english = earlierWords([
    {
      question: "How did I sleep this week?",
      reply: `${coachLines("da").saved}\n\nYou slept 7 hours on average, an hour more than the week before.`,
      status: "done",
    },
  ]);
  assert.equal(linesLanguage(undefined, "Sov 7 timer i nat", ...english), "en");
  // Newest first.
  assert.equal(
    linesLanguage(
      undefined,
      "80 kg",
      ...earlierWords([
        { question: "Jeg har sovet 8 timer", reply: "", status: "done" },
        { question: "I slept 8 hours", reply: "", status: "done" },
      ]),
    ),
    "en",
  );
  // A message saved from a voice check-in is read without its marker.
  assert.deepEqual(
    earlierWords([
      { question: "[voice] Jeg sov godt", reply: "", status: "done" },
    ]),
    ["Jeg sov godt", ""],
  );
  // Nothing tells at all: English.
  assert.equal(linesLanguage(undefined, "80 kg", ...earlierWords([])), "en");
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
