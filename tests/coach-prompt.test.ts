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
    "8c049ae2d5b2de769606deffbb2b4d5122c0f2430fdc236369b11010cd6129bf",
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
