import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  fullPrompt,
  skillInstructions,
  systemPrompt,
} from "../lib/agent/knowledge";
import { skillList, skillNames, skills } from "../lib/agent/skills";
import { coachStyle } from "../lib/agent/coach-style";

test("conversational prompt changes preserve the fixed health, privacy, evidence and action policy", () => {
  // The whole reviewed policy, core and skills; turns get the core plus the
  // skills they load (see the next test).
  const prompt = fullPrompt();
  assert.equal(prompt.split(coachStyle).length, 2);
  assert.equal(
    createHash("sha256")
      .update(prompt.replace(coachStyle, "<COACH_STYLE>"))
      .digest("hex"),
    // Multi-photo atomic saves, same-meal angles, retries and Undo are covered by
    // the 2026-09-20 coach-direct-log-database regression baseline.
    // Historical GEPA scores are not an evaluation of this policy revision.
    // Revised 2026-09-20 for plan_route direction/parkBias/variant guidance only.
    // Revised 2026-09-21 to add search_web: Coach may now read public web pages.
    // Deliberate scope change, reviewed. The only prompt diff is one added
    // paragraph; the health, privacy, evidence and action text is unchanged.
    // It forbids personal data in a query, treats results as untrusted
    // reference text rather than instructions or records about this athlete,
    // and keeps medical claims and logging out of scope (web-search.test.ts).
    // Revised 2026-09-26, deliberate and reviewed: an unfinished workout from
    // another date no longer blocks record_session, and Coach may clear an
    // empty old draft (discard_workout) instead of sending the athlete to
    // Train. Drafts with logged sets can only be finished, never discarded
    // (voice-actions-database.test.ts). Health, privacy and evidence text is
    // unchanged.
    // Revised 2026-09-26 again, deliberate and reviewed: one added paragraph
    // for set_body_goals. Coach collects the athlete's stated details without
    // guessing and reports the app's calculated plan instead of its own
    // figures; it saves only through a reviewed change (body-goals.test.ts).
    // Revised 2026-09-26, deliberate and reviewed: drinks are logged one at
    // a time with log_drink instead of overwriting the check-in water total,
    // and drinks with energy are also logged as a meal in one bundle
    // (hydration.test.ts). Health, privacy and evidence text is unchanged.
    // Revised 2026-09-26, deliberate and reviewed: tiredness, low energy,
    // poor sleep and ordinary soreness are answered practically rather than
    // refused (found by the Coach evals). Pain and red-flag guidance is
    // unchanged.
    // Revised 2026-09-26, deliberate and reviewed: heart rate, HRV, steps,
    // active energy and workouts imported from Apple Health by the iPhone
    // app are recorded measurements Coach may use and attribute; it still
    // must not claim live monitoring or medical records, or read heart rate
    // clinically (native-api.test.ts covers the imported data).
    // Revised 2026-09-26, deliberate and reviewed: two added sentences let
    // Coach name the places of a GPS route Apple Health recorded and show
    // it with show_activity_route; it still never infers a route for an
    // entry without one (workout-routes-database.test.ts). Health, privacy
    // and evidence text is unchanged.
    // Revised 2026-09-26, deliberate and reviewed at the owner's request:
    // Coach is named as weightlifting and gym coach, fat-loss and
    // muscle-building coach and nutrition guide, and says it is not a
    // registered dietitian or doctor. New paragraphs cover body fat readings
    // (record_body_fat, trends over single readings, no judging from photos)
    // and evidence-based fat loss, muscle gain and recomposition guidance
    // with explicit limits: no extreme deficits, eating below resting
    // energy, long fasts, rapid water cuts or unproven supplements, and care
    // plus professional support for disordered eating
    // (body-composition.test.ts). Health, privacy and evidence text is
    // otherwise unchanged.
    // Revised 2026-09-27, deliberate and reviewed: the date, time and
    // timezone moved out of these instructions into a system message sent
    // right after them (requestTime), so this prefix is identical on every
    // turn and the provider can cache it. The only diff is that one
    // sentence: putting the old date sentence back reproduces the previous
    // hash (8c049ae2…). prompt-cache-database.test.ts covers the order.
    // Revised 2026-09-27, deliberate and reviewed: the logging rules say
    // today's records in the "Everything recorded today" message count as
    // read (the server now counts them too, one-call-logs-database.test.ts),
    // so a check-in, a new meal or an activity for today needs no read
    // first; other dates, meal changes and workouts still do. The check-in
    // paragraph's old water-total sentence, which contradicted drink
    // logging, is replaced by a pointer to log_drink, and the drinks rule
    // says how to correct the day's water total (found by the logging-rules
    // GEPA run). Health, privacy and evidence text is unchanged.
    // Revised 2026-09-27 again, deliberate and reviewed, from failures in
    // the hard Coach benchmark (scripts/coach-bench): today's sessions count
    // as read for strength logging too (current_workout is still read);
    // Danish meal names are spelled out (frokost is lunch); and pounds are
    // converted and saved rather than asked about; a drink whose volume
    // isn't given is saved with an estimate (a shake about 300 ml) instead
    // of blocking the save on a question. Health, privacy and evidence text
    // is unchanged.
    // Revised 2026-09-27, deliberate and reviewed, with dynamic skills: the
    // goals paragraph says a calorie or macro target the athlete states is
    // set as given (set_diet_targets), not turned into goal questions; with
    // the goals skill loaded, Coach asked for age instead. Health, privacy
    // and evidence text is unchanged.
    // Revised 2026-09-28, deliberate and reviewed at the owner's request:
    // calories burned are shown on activities and timed workouts, measured
    // by a watch or estimated by the app in code (lib/energy.ts, MET or
    // heart-rate formulas, energy.test.ts). Coach quotes those figures and
    // marks estimates, but still never works one out itself, never saves an
    // estimate as an entry's energy, and never lets it change food targets.
    // Health, privacy and evidence text is otherwise unchanged.
    // Revised 2026-09-28 again, deliberate and reviewed at the owner's
    // request: one added paragraph has Coach log supplements the athlete
    // took with log_supplement, as said and without invented amounts;
    // protein powder stays food. It must not prescribe or change doses or
    // claim a supplement treats a condition, and points to a doctor or
    // pharmacist for deficiencies, high doses, pregnancy or interactions
    // (supplements.test.ts). Health, privacy and evidence text is otherwise
    // unchanged.
    // Revised 2026-09-28, deliberate and reviewed, with the native visual
    // kinds: show_visual is also used unasked when numbers read better as a
    // visual (progress, trends, splits, comparisons, headline numbers, days),
    // loading the review skill if needed, and its values aren't repeated in
    // a Markdown table. Asked for targets, a macro split and training days,
    // Coach answered with a Markdown table and no visual. Health, privacy
    // and evidence text is unchanged.
    // Revised 2026-10-02, deliberate and reviewed at the owner's request:
    // Lift Journal is a health app for everyone. Coach's persona leads with
    // sleep, food and drink, movement and training and habits, stays the
    // fat-loss and muscle-building coach and nutrition guide, keeps strength
    // and Olympic weightlifting expertise for those who lift, and meets
    // people where they are; the site description lists the areas in that
    // order. Health, privacy, evidence and action policy text is unchanged.
    // Revised 2026-10-02 again, deliberate and reviewed: goal setup asks for
    // the missing details in at most two short messages (body facts, then the
    // goal, activity, training days and experience) instead of one question
    // at a time, for the iPhone's first steps. Checked live: two replies to a
    // reviewed set_body_goals card. Nothing else changed.
    // Revised 2026-10-02 a third time, deliberate and reviewed at the owner's
    // request ("we should never use em dashes"): the two em dashes in the
    // route-planning paragraph become semicolons, so the base prompt models
    // the no-em-dash rule coachStyle already states. Wording is unchanged.
    // Revised 2026-10-03, deliberate and reviewed: one added paragraph, the
    // new recipes skill's (loaded only for recipes and meal ideas). Coach
    // shows a recipe or meal idea as a show_visual recipe card fitted to
    // the request and, when relevant, the athlete's targets and known food
    // preferences: every ingredient with its amount, short steps, and
    // estimated kcal and protein per serving (carbs and fat when useful),
    // then a sentence or two without repeating the card. A suggested recipe
    // is not a meal eaten and is logged only when the athlete says they ate
    // it. Removing that one paragraph reproduces the previous hash
    // (aef4e3f5…); coach-visual-kinds.test.ts and skills.test.ts cover the
    // card and the skill. Health, privacy and evidence text is unchanged.
    "f44bfc1121288961670762d6af1999b269c49452cd333be271381c8430c0d0b0",
    "A fixed-policy change requires deliberate review and a fresh evaluation baseline.",
  );
  assert.ok(coachStyle.length >= 100 && coachStyle.length <= 4500);
});

test("Coach policy separates reported events, previews and advice", () => {
  const prompt = systemPrompt();
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
  assert.match(systemPrompt(false), /This client uses reviewed logging/);
});

test("the core prompt and the skills together are exactly the reviewed policy", () => {
  for (const logging of [true, false]) {
    const full = fullPrompt(logging).split("\n");
    const core = systemPrompt(logging).split("\n");
    assert.equal(core.at(-1), skillList);
    const skillLines = skillNames.flatMap((name) =>
      skillInstructions([name], logging).split("\n").filter(Boolean),
    );
    // Every paragraph is in the core or in exactly one skill, never lost.
    assert.deepEqual(
      [...core.slice(0, -1), ...skillLines].sort(),
      [...full].sort(),
    );
    assert.equal(new Set(skillLines).size, skillLines.length);
  }
  // Each skill paragraph start matches exactly one paragraph, so an edit to
  // a paragraph's opening can't silently move it into the core.
  for (const name of skillNames)
    for (const start of skills[name].paragraphs)
      assert.equal(
        fullPrompt()
          .split("\n")
          .filter((line) => line.startsWith(start)).length,
        1,
        `${name}: "${start}"`,
      );
});
