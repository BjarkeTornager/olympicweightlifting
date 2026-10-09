import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  fullPrompt,
  siteHelp,
  skillInstructions,
  systemPrompt,
} from "../lib/agent/knowledge";
import { skillList, skillNames, skills } from "../lib/agent/skills";
import { coachStyle } from "../lib/agent/coach-style";
import {
  caffeineRule,
  disorderedEatingRule,
  drinksTargetRule,
  supplementRule,
  teenSleepRule,
} from "../lib/agent/health-rules";
import {
  CARBS_FLOOR_G,
  macroShares,
  proteinPerKg,
  weeklyRates,
} from "../lib/body-goals";

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
    // Revised 2026-10-03, deliberate and reviewed: pictures of dishes. The
    // recipes paragraph gains one sentence: only when the athlete asks to
    // see the dish, show_visual's picture is set, an AI picture of the food
    // follows on the card, Coach never describes it as if it could see it,
    // and says plainly when none is available. The skill list's recipes
    // summary adds "with an optional picture of the dish". Only the dish
    // name and up to five ingredient names reach the image model
    // (coach-pictures.test.ts); pictures are kept apart from the photo
    // library and never count as a meal (coach-pictures-database.test.ts).
    // Removing that sentence and restoring the old summary reproduces the
    // previous hash (f44bfc11…). Health, privacy and evidence text is
    // unchanged.
    // Revised 2026-10-04, deliberate and reviewed, from the evidence review
    // of every target the app sets (PR 1, Coach prompts):
    // - Shared health rules (agent/health-rules.ts, also in the voice
    //   coach's instructions) in the always-loaded core. The supplement
    //   rule replaces the supplement paragraph's last sentence: no
    //   prescribing, creatine 3–5 g only as information for adults, no
    //   performance supplements under 18, in pregnancy or breastfeeding,
    //   with a condition or on medication, food first. Two added
    //   paragraphs: a caffeine rule (EFSA limits, minors, pregnancy, sleep,
    //   no powder) and the bingeing and purging rule, moved out of the goals
    //   skill and extended to laxatives, diuretics, appetite suppressants
    //   and fat burners taken to make weight. The drinks paragraph gains the
    //   drinks target rule (not a minimum, a clinician's fluid limit comes
    //   first, no water cuts). The reference paragraph adds teen sleep
    //   (8–10 h) and replaces the NHS link with WHO 2020 and Danish Health
    //   Authority activity guidance, given as general adult guidance when
    //   age is unknown.
    // - The goals skill's coaching paragraph quotes the plan's own rates
    //   and protein (weeklyRates and proteinPerKg in body-goals.ts) instead
    //   of 0.5–1 %, 0.25–0.5 %, 1.6–2.4 and 1.6–2.2 g/kg; says at least 7
    //   hours of sleep; replaces "daily steps" with keeping everyday
    //   movement near usual and never walking off food; and no longer
    //   allows "creatine, caffeine". The setup paragraph's rates come from
    //   the same constants, with identical text.
    // - Apple Health active energy is Apple's estimate, not a recorded
    //   measurement; dailyTargets are the athlete's targets, shown on Food
    //   and in the iPhone app, while the website's Goals card on Today
    //   shows goals.plan's calories, which can differ. goals.plan is a
    //   recalculation to offer for review, never the current target, and
    //   Coach explains the Goals card's number when asked.
    // - The supplement rule asks the athlete's age before describing any
    //   amount when it isn't known, as the caffeine rule already did
    //   (coachingContext now carries the age, from the goals or Settings).
    // Privacy and action policy text is unchanged.
    // Revised 2026-10-04, deliberate and reviewed, from the same review
    // (PR 11, water): the drinks paragraph only. Beer, wine and spirits join
    // the drinks with energy that also need a record_meal (alcohol has 7
    // kcal a gram); they count towards the drinks total, but Coach never
    // suggests alcohol to rehydrate. A usual size saved because no volume
    // was given is marked estimated=true. The target is an estimated range
    // that the athlete can hide, and the sentence about record_checkin
    // waterMl goes, since check-ins no longer hold water
    // (hydration.test.ts). The drinks target rule above stays in the
    // paragraph. Restoring that paragraph reproduces the previous hash
    // (74336db6…). Health, privacy and evidence text is otherwise
    // unchanged.
    // Revised 2026-10-04, deliberate and reviewed at the owner's request
    // ("Coach should be able to add any exercise that the user requests"):
    // the core workout continuity paragraph gains three sentences. Any
    // exercise the athlete names can be logged, planned or added: the
    // catalogue id when it is the same movement, otherwise custom:<their
    // name for it>, never a refusal, a request for permission or a
    // different exercise, and the custom id already shown is reused. Sets
    // still to do go into the ongoing workout with the new
    // add_workout_exercise and are never logged as done (without that
    // sentence Coach logged "jeg tager dem efter squats" as done in the
    // Coach benchmark). The programmes paragraph's custom sentence no longer
    // limits custom ids to "explicitly named" movements; it still forbids
    // invented catalogue IDs. The server makes the ids canonical
    // (custom-exercises.test.ts). Removing the three sentences and restoring
    // the old one reproduces the previous hash (2457ba00…). Health, privacy
    // and evidence text is unchanged.
    // Revised 2026-10-05, deliberate and reviewed at the owner's request
    // (Coach asked whether to save the food and drinks or the five
    // supplements first, because a save held six entries): one report goes
    // into ONE record_bundle of up to 30 entries, never split into several
    // saves or a question about which to save first; only beyond 30 does
    // Coach save the first 30 and say what is left. The server allows 30
    // (BUNDLE_MAX). Restoring the "2–6 entries" sentence reproduces the
    // previous hash (14390d3e…). Health, privacy and evidence text is
    // unchanged.
    // Revised 2026-10-04, deliberate and reviewed, from the evidence review
    // (PR 10, energy expenditure), and carried onto the 2026-10-05 text on
    // 2026-10-09 without change: the health paragraph's calories rule
    // gains two sentences. activeEnergy and burnedInTraining overlap, since
    // a watch counts the training it saw, so Coach quotes them separately,
    // never adds them together and never subtracts either from food eaten,
    // as the voice coach already does; and when burnedInTraining lists
    // lifting_sessions_without_length or entries_without_estimate, Coach
    // says its figure leaves those out. Removing them reproduces the
    // previous hash (14eaff26…). Health, privacy and action policy text is
    // otherwise unchanged.
    // Revised 2026-10-09, deliberate and reviewed, from the review of PR 10:
    // the cardio paragraph stops calling a watch's calories measured, since
    // they are an estimate too. "the app estimates calories burned itself
    // when none was measured" now ends "when none was recorded", and
    // "Activity calories, measured or estimated," now reads "Activity
    // calories, recorded or estimated,". Restoring those two words
    // reproduces the previous hash (7786ae88…). Health, privacy and action
    // policy text is otherwise unchanged.
    // Revised 2026-10-04, deliberate and reviewed, from the evidence review
    // (PR 4, maintenance and training), brought in after the notes above,
    // in the goal-setup paragraph only: goal setup also asks the usual
    // session length, which the plan now uses to count training energy for
    // the sessions it sets ("training days available and experience" and
    // "training days and experience" gain session length), and everyday
    // activity gains very_high for heavy manual work, which the plan counts
    // at 2.0 times resting energy ("(low/moderate/high)" gains it).
    // Restoring those three phrases reproduces the previous hash
    // (935bdded…). Health, privacy and evidence text is unchanged.
    // Revised 2026-10-04, deliberate and reviewed, from the same review
    // (PR 5, macros), so Coach describes the macros the plan now sets: the
    // goal-setup paragraph adds protein from a height-adjusted weight at a
    // BMI of 30 or more, fat at 25 % of calories and carbohydrate as the
    // rest, at least 130 g (macroShares and CARBS_FLOOR_G in
    // body-goals.ts); the coaching paragraph adds 2 g/kg of a
    // height-adjusted weight at a BMI of 30 or more while losing
    // (proteinPerKg.adjusted) and "less at a BMI of 30 or more" while
    // gaining. Restoring those three phrases reproduces the previous hash
    // (74eef4c7…). Health, privacy and evidence text is unchanged.
    "49dda6a478176ba8a8edaba86727cbd14284b3f386686dc6e543dd64c4a61251",
    "A fixed-policy change requires deliberate review and a fresh evaluation baseline.",
  );
  assert.ok(coachStyle.length >= 100 && coachStyle.length <= 4500);
});

test("Coach quotes active energy and training apart, as estimates, never added together", () => {
  const prompt = systemPrompt();
  assert.match(
    prompt,
    /activeEnergy \(Apple Health's estimate of all movement so far\) and burnedInTraining overlap/,
  );
  assert.match(
    prompt,
    /quote them separately, never add them together, and never subtract either from food eaten/,
  );
  assert.match(
    prompt,
    /entries_without_estimate, say its figure leaves those out/,
  );
  // A watch's calories are an estimate too, never called measured.
  assert.doesNotMatch(prompt, /when none was measured|measured or estimated/);
  assert.match(prompt, /Activity calories, recorded or estimated, are/);
  // The site help agrees with what Today shows.
  assert.doesNotMatch(siteHelp.health, /measured when a watch recorded it/);
  assert.match(
    siteHelp.health,
    /calories burned, always an estimate \(a watch's included\) of the energy used above rest/,
  );
  assert.match(siteHelp.health, /never added together/);
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

test("the health rules hold on every turn, not only when a skill loads", () => {
  for (const logging of [true, false]) {
    // The core prompt alone, with no skill loaded.
    const core = systemPrompt(logging);
    for (const rule of [
      supplementRule,
      caffeineRule,
      disorderedEatingRule,
      drinksTargetRule,
      teenSleepRule,
    ])
      assert.ok(core.includes(rule), rule.slice(0, 40));
  }
  const core = systemPrompt();
  // Purging, including laxatives and diuretics, on an ordinary log.
  assert.match(core, /bingeing, purging, fear of food or eating very little/);
  assert.match(core, /Laxatives, diuretics, appetite suppressants/);
  // Supplements and caffeine are discussed, never prescribed.
  assert.match(core, /Don't prescribe supplements, doses or dose changes/);
  // No amount, supplement or caffeine, before Coach knows the athlete's age
  // (coachingContext's age, from the goals or Settings).
  assert.ok(
    supplementRule.includes(
      "If you don't know their age, ask before describing any amount.",
    ),
  );
  assert.match(caffeineRule, /If you don't know their age, ask before giving/);
  assert.match(core, /Caffeine is optional: you may discuss it, never/);
  assert.match(core, /200 mg at once and 400 mg a day from all sources/);
  assert.match(core, /Under 18: no performance dosing/);
  // The drinks target is not a minimum, and a clinician's limit wins.
  assert.match(core, /not a minimum/);
  assert.match(core, /fluid limit from their doctor or another clinician/);
  // Teens need more sleep than adults.
  assert.match(core, /Teenagers \(13–17\) need 8–10 hours/);
  // Activity guidance from WHO and the Danish Health Authority.
  assert.doesNotMatch(fullPrompt(), /NHS|nhs\.uk/);
  assert.match(core, /WHO 2020 guidelines/);
  assert.match(core, /Danish Health Authority recommends adults move/);
  assert.match(core, /when age is unknown, give the adult guidance/);
  // Apple's active energy is an estimate, not a measurement.
  assert.match(core, /active energy is Apple's estimate, not a measurement/);
  assert.doesNotMatch(core, /active energy and workouts .{0,80}recorded/);
  // The saved targets are the athlete's; the plan is only a proposal, and
  // the website's Goals card shows the plan's calories until it shows the
  // saved target.
  assert.match(core, /The athlete's daily targets are dailyTargets/);
  assert.match(
    core,
    /the website's Goals card on Today shows goals\.plan's calories, which can differ/,
  );
  assert.match(core, /never present it as their current target/);
  // Moved out of the goals skill, not copied, and no supplement allowance.
  const goals = skillInstructions(["goals"]);
  assert.doesNotMatch(goals, /bingeing|purging/);
  assert.doesNotMatch(goals, /creatine|caffeine, protein powder/);
  assert.match(goals, /the supplement and caffeine rules apply/);
});

test("Coach quotes the plan's own rates and protein", () => {
  const percent = (rate: number) => Math.round(rate * 10000) / 100;
  const { lose, gain, recomposition } = weeklyRates;
  const losing = `${percent(lose.lean)}–${percent(lose.higher)} % of bodyweight a week`;
  const gaining = `${percent(gain.experienced)}–${percent(gain.new)} %`;
  const recomposing = `at most ${percent(recomposition)} %`;
  const [setup, coaching, ...rest] = skillInstructions(["goals"]).split("\n");
  assert.equal(rest.length, 0);
  // Goal setup describes the calculation.
  assert.ok(setup.includes(`losing ${losing} depending on body fat`));
  assert.ok(setup.includes(`gaining ${gaining} by experience`));
  assert.ok(setup.includes(`recomposition ${recomposing};`));
  // Coaching uses the same figures and the same protein per kg.
  assert.ok(coaching.includes(`losing about ${losing}`));
  assert.ok(coaching.includes(`about ${gaining} a week`));
  assert.ok(coaching.includes(`${recomposing} a week either way`));
  const { bodyweight, leanMass, adjusted } = proteinPerKg;
  assert.ok(
    coaching.includes(
      `the app sets ${bodyweight.losing} g/kg of bodyweight, ${adjusted.losing} g/kg of a height-adjusted weight at a BMI of 30 or more, or ${leanMass.losing} g/kg of lean mass when body fat is known`,
    ),
  );
  assert.ok(
    coaching.includes(
      `the app sets ${bodyweight.other} g/kg of bodyweight, less at a BMI of 30 or more, or ${leanMass.other} g/kg of lean mass`,
    ),
  );
  // Goal setup names the plan's fat share and carbohydrate floor.
  assert.ok(
    setup.includes(
      `or from a height-adjusted weight at a BMI of 30 or more; fat ${macroShares.fat} % of calories; carbohydrate the rest, at least ${CARBS_FLOOR_G} g)`,
    ),
  );
  // Every rate and protein figure in it is one of the plan's.
  const planPercents = new Set(
    [...Object.values(lose), ...Object.values(gain), recomposition].map(
      percent,
    ),
  );
  for (const [, low, high] of coaching.matchAll(/([\d.]+)–([\d.]+) %/g))
    for (const value of [low, high])
      assert.ok(planPercents.has(Number(value)), `${value} %`);
  const planProtein = new Set(
    [
      ...Object.values(bodyweight),
      ...Object.values(leanMass),
      ...Object.values(adjusted),
    ].map(String),
  );
  for (const [, value] of coaching.matchAll(/([\d.]+) g\/kg/g))
    assert.ok(planProtein.has(value), `${value} g/kg`);
  // The old figures, which disagreed with the app, are gone.
  assert.doesNotMatch(coaching, /0\.5–1 %|0\.25–0\.5 %|1\.6–2\.[24]/);
  // At least 7 hours, and everyday movement instead of a step quota.
  assert.match(coaching, /at least 7 hours of sleep for adults/);
  assert.doesNotMatch(coaching, /7–9 hours|daily steps/);
  assert.match(coaching, /never on top of it to make up for food/);
});

test("site help says Goals calculates calories and macros", () => {
  assert.doesNotMatch(siteHelp.nutrition, /No calorie needs calculation/);
  assert.match(
    siteHelp.nutrition,
    /Goals on Today .* calculates daily calories, protein, carbs and fat/,
  );
  assert.match(siteHelp.nutrition, /starting estimates, not measured needs/);
  assert.match(siteHelp.nutrition, /There is no food database integration/);
});
