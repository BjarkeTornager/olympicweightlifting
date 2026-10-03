# Lift Journal targets: do they follow the science?

This reviews `origin/main` at `98124b4` (Merge #88, 3 October 2026). It was read only. Nothing in the repository was changed.

**How this was done.** Each of the 23 targets had two reviewers.
- The first read the code, ran the real `planGoals` (and other functions) where it mattered, and checked the published guidance.
- The second opened every source again, re-ran the numbers and corrected the first review.

This report keeps only the claims that survived that second check, with the corrections applied. Some recommended numbers are engineering or product choices rather than something a source states. Those are marked **(design choice)**. Evidence that is thin, indirect or from a different population is called out as such.

**Terms used throughout**

- **Resting energy (RMR, BMR)**: what the body burns at complete rest.
- **PAL**: physical activity level, which is total daily energy divided by resting energy.
- **FFM**: fat-free mass, roughly "lean mass".
- **Energy availability (EA)**: calories eaten minus exercise calories, divided by fat-free mass. It is measured in kcal per kg FFM per day.
  - About 45 matches energy balance.
  - 30-45 is the range used for fat loss.
  - At or below 30, health effects have been shown in women.
  - The IOC says the 30 cut-off is debated, and the level in men appears lower and less clear (about 9-25). It also warns against using EA as a precise diet prescription, because intake, exercise energy and FFM are all measured with large error [1].
- **MET**: a multiple of resting metabolism. 1 MET is about 1 kcal per kg per hour. "Gross" MET figures include that resting part [95].

---

## 1. Summary

**Overall verdict: partly adheres.** All 23 targets got this verdict, for the same broad reason. Most individual constants sit inside published ranges. The way they are combined and applied falls short of the evidence, in ways that matter for weightlifters.

What is already right:

- Both resting-energy equations are real and correctly coded. One is Mifflin-St Jeor [11]. The "Katch-McArdle" formula is Cunningham 1991 [13].
- Loss rates of 0.4-0.75 % of bodyweight a week, slower when lean, sit inside every sports position stand checked [2, 18, 19, 22, 23].
- Gain rates of 0.15-0.35 % a week are at or below the published ranges [20, 21].
- Protein of 1.8-2.0 g/kg (or 2.2-2.5 g/kg lean mass) fits ISSN, ACSM and meta-analysis ranges for normal-weight adult lifters [2, 59, 60, 18, 19].
- Fat at 25 % of energy is inside every reference range [2, 63, 70, 71].
- Counting coffee, tea and milk as fluid is supported [109, 113, 117, 118].
- 5 MET for a lifting session is a real Compendium value [95].
- There is no sleep target, step target or readiness score. That fits the athlete sleep consensus and WHO [128, 135].
- Calories burned never change food targets. Coach is told not to invent calorie figures or tell athletes to "earn" food.

Where it falls short:

1. **No real lower bound and no screening.**
   - The only calorie floor is resting energy, which ignores training.
   - Under-18s still get an automatic deficit. So do pregnant or breastfeeding users, and people whose current or goal weight is underweight.
   - Goal weights that imply body fat below healthy minimums are never flagged.
2. **Maintenance is set low.** The everyday-activity factors (1.2 / 1.375 / 1.55) are below what doubly labelled water studies show for daily living alone. Real deficits are therefore larger than the plan says.
3. **The plan never learns and never ends.**
   - It uses the weight typed at setup forever and ignores weigh-ins.
   - It keeps cutting after the goal or date.
   - It shows two different calorie numbers on different screens.
4. **Per-kg rules on total bodyweight break for heavy users.** A 140 kg lifter gets 280 g protein, 43 % of energy from fat and 51 g carbohydrate. At 200 kg the macros add up to more than the calorie target.
5. **Coach is told different numbers from the app.**
   - Some safety rules only load in "goals" conversations.
   - The voice coach lacks several referral rules.
6. **False precision.**
   - Watch and Apple Health energy are labelled "measured".
   - Gross and net energy are added together.
   - Targets are shown to the kcal and gram.

### The six changes that matter most

1. **Put the safety gates in code, inside `planGoals`, not only in prompts.**
   - Under 18: no app-generated deficit, no body-fat targets, and a youth energy equation.
   - Pregnancy: no deficit.
   - Breastfeeding: maintenance plus the lactation allowance.
   - Adults with a current or goal BMI under 17.5: no loss plan.
   - Goal weights that imply body fat below about 5 % (men) or 12 % (women): warn, and plan only to a safer weight.
2. **Raise maintenance and replace the floor.**
   - Use everyday factors of 1.4 / 1.55 / 1.75.
   - Set the floor to resting energy plus training energy, with an absolute minimum.
   - Cap deficits at 500 kcal a day unless body fat is high.
   - Recompute the stated weekly rate and weeks whenever a floor or cap changes the calories.
3. **Close the loop.**
   - Use one current weight (the 7-day average of check-ins) everywhere.
   - Show one calorie target everywhere.
   - Propose maintenance when the goal or date is reached.
   - After 3-4 weeks, propose reviewed adjustments from the weight trend.
4. **Fix the macros for heavy and low-calorie plans.**
   - Protein from lean mass. When BMI is 30 or more and body fat is unknown, use an adjusted weight instead.
   - Fat as 25 % of energy, with no per-kg floor.
   - A 130 g carbohydrate floor.
   - A test that the macros always add up to the calories.
5. **Make Coach say what the app does.**
   - One set of rates and protein numbers.
   - Move the purging, supplement, caffeine and teen-sleep rules into the always-loaded prompt and the voice prompt.
   - Stop letting Coach "prescribe" caffeine or creatine.
   - Fix `site_help`.
6. **Be honest about precision.**
   - Label device energy as an estimate.
   - Use one definition of "burned".
   - Round targets (50 kcal, 5 g, 0.25 L).
   - Show ranges for fat, carbohydrate and water.
   - Treat protein as a minimum rather than a ceiling.

---

## 2. Overview table

| Target | What we do now | What the evidence supports | Verdict | Priority |
|---|---|---|---|---|
| Resting energy | Mifflin-St Jeor, or Cunningham 1991 when any body-fat reading exists; resting energy is the calorie floor | Equations fine for adults; large individual error in athletes; youth need Henry equations; a floor for people who train must allow for training energy | Partly adheres | High (floor, minors); Medium (equation choice) |
| Maintenance | Resting x 1.2 / 1.375 / 1.55, plus 4.5 MET x available days x session minutes | Everyday PAL about 1.4 / 1.55 / 1.75 (NNR, FAO, NASEM); net training energy; recalibrate from weight trend | Partly adheres | High |
| Calorie target | Maintenance minus rate x 7,700/7; floored at resting; saved once | Rate is fine; needs a training-aware floor, safety gates, an end point and feedback | Partly adheres | High |
| Rate, focus, weeks | 0.4 / 0.5 / 0.75 % loss, 0.15-0.35 % gain; anchored to setup weight; hard body-fat steps | Constants supported; apply to current weight, cap deficits near 500 kcal, smooth thresholds, check implied body fat | Partly adheres | High |
| Protein | 1.8 / 2.0 g/kg bodyweight, or 2.2 / 2.5 g/kg lean mass | Fine for normal-weight adults; not total weight in obesity; kidney, pregnancy, youth handling | Partly adheres | High (obesity); Medium (others) |
| Fat | max(0.8 g/kg total weight, 25 % of energy) | 25 % of energy is fine; per-kg floor on total weight has no support as a floor | Partly adheres | High |
| Carbohydrate | Whatever is left, never below 0 | Keep the remainder method; add a 130 g floor and make macros add up | Partly adheres | High |
| Manual targets | Any 0-10,000 kcal saved as typed; Coach update replaces the whole object | Respect the athlete's number but show the same floor note; fix the partial-update bug | Partly adheres | High (floor note); Medium (bug) |
| Progress display | "980 of 1,900", exact numbers, "above target" for every macro | Show estimates as estimates; protein as a minimum; no "above target" on unsafe targets | Partly adheres | High (low targets); Medium |
| Burn, cardio | Watch value ("measured"), else Keytel heart-rate equation, else MET x kg x h | Structure fine; watch energy is an estimate; Keytel only for steady cardio in its range | Partly adheres | Medium |
| Burn, strength | 5 MET x kg x (finish minus start), 10-240 min | 5 MET is a real value, on the generous side; durations are unreliable | Partly adheres | Medium |
| Burn, today | Apple active energy if present, else training estimates | Label as estimate; do not drop lifting Apple never saw; one figure for Today and Coach | Partly adheres | High (labels); Medium |
| Water target | 35 ml/kg + 600 ml/h on a lifting day | Fine for active 55-95 kg lifters; too high for heavy users and non-lifters; needs bounds and ranges | Partly adheres | High (heavy users, bounds); Medium |
| What counts as water | Every drink 1:1 | Supported; add alcohol handling and clearer labels | Partly adheres | Medium |
| Sleep | No target; compares with own recent nights | Keep no target; add teen 8-10 h; surface chronic short sleep | Partly adheres | High (teens); Medium |
| Steps | No target; stored and averaged | Keep no target; frame "daily steps" during cuts; label active energy as estimate | Partly adheres | Medium |
| Goal weight and trend | Goal BMI under 18.5 adds a note; trend from two weigh-ins | Gate loss plans on low BMI; least-squares trend; compare trend with plan | Partly adheres | High |
| Body fat | Targets and readings 3-70 %; adult limits for everyone | No targets under 18; minimum-weight check; method-aware readings | Partly adheres | High |
| Sessions per week | min({3, 4, 5}, max(days, 2)), written into the lifting brief | Never overwrite the brief; no floor of 2; no hard cap for experienced | Partly adheres | High (brief); Medium |
| Supplements | No targets or doses; Coach may "prescribe the basics" | Keep no doses; one consistent rule; handle laxatives and diuretics; voice parity | Partly adheres | High |
| Caffeine | Not tracked; only rule lets Coach "prescribe" it | Add a core caffeine rule with EFSA limits, minors and pregnancy | Partly adheres | High |
| Coach goal setup | Two short messages, reviewed (text) or saved directly (voice) | Screen for pregnancy, age, low-energy signs; confirm deficits in voice; ask session length and weigh-in | Partly adheres | High |
| Load progression | +2 kg when all sets are made, unless RPE above 8 or a miss | Recognised model; needs an effort check when RPE is missing, return-from-break and youth handling | Partly adheres | High (effort gate); Medium |

---

## 3. Target by target

### 3.1 Resting energy (`energy.resting`)

**What it does.**
- `lib/body-goals.ts` `planGoals()` L105-115 checks for a body-fat reading from the last 90 days (`lib/body-composition.ts` `latestBodyFat()` L102-113). Any method counts, and an athlete's own report beats Apple Health on the same day.
  - With a reading: lean mass = setup weight x (1 - BF/100), then `370 + 21.6 x LBM`.
  - Without one: Mifflin-St Jeor `10W + 6.25H - 5A + s`, where s = +5 male, -161 female, -78 unspecified.
- The result is rounded to 10 kcal (L241).
- Resting energy is also the calorie floor (L176-181). Coach is told "never prescribe eating below resting energy" (`lib/agent/knowledge.ts` L134).
- The value reaches Coach through `lib/coaching.ts` L226 and is never shown in the UI.
- The web goals form defaults sex to "Prefer not to say" (`components/goals.tsx` L105, L195-200).

**What the evidence says.**

- **The constants are correct.** Mifflin was derived in 498 healthy adults aged 19-78 [11]. It was the most reliable equation in non-athletes, with notable individual errors [12]. `370 + 21.6 x FFM` is Cunningham's 1991 general equation [13].
- **Mifflin has large individual error in athletes.** A 2023 meta-analysis found:
  - Only about 52 % of athletes fall within plus or minus 10 % of measured RMR, and it lists Mifflin among equations to avoid [14].
  - The direction of the error varies by study.
  - Every other equation scored 41-64 %. Ten Haaf scored 80 %, but from 3 studies (177 people) that include its own derivation group.
  - Cunningham 1991 did not differ significantly from measured RMR.
  - The one study in weightlifters found every equation about 18 % or more too low [14].
- **FFM equations do better in athletes.**
  - In recreational athletes, Cunningham 1980 (`500 + 22 x FFM`) was accurate in about 80-85 % [15].
  - In physique athletes, the FFM equations of ten Haaf and Cunningham 1980 were acceptable [16].
  - The 2016 joint position names Cunningham or Harris-Benedict for athletes [2].
- **Youth.** For 10-18-year-olds, NNR and EFSA use the Henry equations and allow for growth [6, 8]. Growth needs EA of 45 kcal/kg FFM or more, and body composition should be assessed under 18 only for medical reasons [1].
- **Consumer bioimpedance** is "doubly indirect" and not valid for individuals [1]. Limits of agreement are 15-20 body-fat points, with FFM errors often beyond plus or minus 6 kg [47].
- **No floor at RMR.** No consensus statement uses resting energy as a minimum intake for athletes. The IOC frames minimum intake through energy availability [1].
- **Pregnancy and lactation.** Pregnancy adds about 70 / 260 / 500 kcal a day by trimester. Lactation adds about 500 kcal a day in months 0-6 [7].

Worked numbers, illustrative, from the real `planGoals`:
- For young lifters, ten Haaf gives 10-14 % (about 160-275 kcal) more than Mifflin.
- One body-fat reading switches resting energy by -150 to +340 kcal.
- Combining the setup weight with a newer reading adds about 100 kcal.
- A 24-year-old woman (160 cm, 59 to 55 kg, 5 x 90 min) gets 1,530 kcal. That is EA about 27 at target and about 22 at the resting floor. These use gross training energy; net would add about 1-1.5.

**What to change.**

1. **Floor**: see 3.3. Resting energy alone is not a safe minimum for someone who trains. Reword the plan note and the Coach line: resting energy is what the body uses at complete rest, not a safe minimum on training days.
2. **Under 18**: use Henry 10-18, and keep body-fat readings out of the formula.
   - Boys: `(0.0651 x W + 1.11 x H_m + 1.25) x 239` kcal.
   - Girls: `(0.0393 x W + 1.04 x H_m + 1.93) x 239` kcal.
   - In the examples this is about 66-84 kcal above Mifflin.
3. **Equation choice (medium)**: keep Mifflin as the default starting point.
   - Ten Haaf is an option only inside its derivation range: age 18-35, 52.8-100.3 kg, 161-205 cm, and training at least 3 days a week. The formula is `11.936 x W + 587.728 x H_m - 8.129 x A + 191.027 x [male] + 29.279`, with 95.5 in place of the male term for unspecified sex.
   - Recalibrating from the weight trend (3.3) matters more than the equation.
4. **Body-fat path**: use an FFM equation only for a trusted reading **(design choice)**.
   - Trusted means DXA, BodPod, trained calipers, or the median of at least 3 scale readings within 14 days.
   - Pair it with a weight from the same day, or within 7 days.
   - When it is used, prefer Cunningham 1980 (`500 + 22 x FFM`), as named by ACSM and supported in athlete studies [2, 15, 16]. This is a modest preference, since Cunningham 1991 has not been shown to be biased.
   - Label the source in Coach context ("Cunningham, scale 18 % on 12 Sep").
5. **Pregnancy and lactation**: see 3.3.
6. **Precision**: give Coach the formula and a plus or minus 10 % range. If the value is ever displayed, round it to 50 kcal.
7. **Sex default**: do not preselect "Prefer not to say" (see 3.22).

**Safety notes.** The minors and floor items are safety issues. The equation choice is not. Its error is about the size of a planned deficit, and recalibrating from weigh-ins handles that better than any equation.

---

### 3.2 Maintenance energy (`energy.maintenance`)

**What it does.**
- `lib/body-goals.ts` L71, L116-119: `maintenance = resting x {low 1.2, moderate 1.375, high 1.55} + trainingDays x sessionMinutes x 0.075 x kg / 7`.
- The factor is described as "movement outside training" (L22-23).
- 0.075 kcal/kg/min is about 4.5 MET gross. It is added on top of 24 hours of resting x factor.
- `trainingDays` is availability ("Days I can train"), not the sessions the plan prescribes.
- Session length defaults to 75 min.
  - The web form has no field for it, and text Coach never asks (`components/goals.tsx` L105-125; `knowledge.ts` L132).
  - Voice asks but does not require it (`lib/voice-checkin.ts` L175, L688-697).
- Weight is the setup weight only.

**What the evidence says.**

- **NASEM 2023** [9]:
  - People who only do daily living ("inactive") have a typical PAL of about 1.4 (band 1.0 to under 1.53).
  - Low active is about 1.6, active about 1.75, very active about 2.05.
  - Individual error is about 339 kcal (men) and 246 kcal (women) a day, so NASEM's step 2 is to monitor weight and adjust.
- **FAO/WHO/UNU**: free-living adults sustain a PAL of about 1.40-2.40. Values below 1.40 are reported only in clinical or confined groups [10].
- **NNR 2023** [6]:
  - PAL 1.1-1.2 is bed- or chair-bound, 1.3-1.5 is seated work with little leisure activity, 1.6-1.7 is seated work with some movement, and 1.8-1.9 is standing work.
  - NNR uses 1.4 / 1.6 / 1.8 as reference levels.
  - It adds about 0.025 PAL per weekly hour of moderate activity. That works out at about 4 kcal per kg per hour of net training energy.
- **The current factors.**
  - I could not trace any validation of 1.2 / 1.375 / 1.55.
  - 1.2 and 1.375 sit inside NASEM's inactive band but below its typical value [9].
  - 1.2 is below the 1.40 free-living floor of FAO and NNR [10, 6].
  - "Physical work" at 1.55 is below NNR's 1.8-1.9 for standing work [6].
- **Training energy.** Measured lifting sessions span about 3-8 MET [105]. The current formula counts resting energy during sessions twice, about 55-76 kcal a day in the examples.

Worked numbers:
- For most "mostly sitting" lifters, the app's maintenance (including 3-10 hours a week of lifting) is:
  - about 250 kcal a day below NNR's own method;
  - 200-460 kcal below NASEM's inactive equation, in 86 % of a test grid.
- The 88 kg test athlete sits right at NASEM inactive (2,830 vs 2,809).
- For a 63 kg woman with a desk job lifting 4 x 90 min, a planned 0.5 %/week cut may really run at about 0.85-1 %/week.

**What to change.**

1. **Everyday factors**: use `{low 1.4, moderate 1.55, high 1.75}`, optionally with a "heavy manual work" level at 2.0. Never let maintenance fall below 1.4 x resting [6, 10]. These are conservative against NASEM's equations and match NNR's method.
2. **Training energy net of resting**: `trainingPerDay = sessionsPerWeek x minutes/60 x 4.0 x kg / 7`.
   - 4.0 kcal/kg/h net is consistent with NNR's +0.025 PAL per weekly hour [6] and with the burn estimate in 3.11.
   - Use one shared constant for the plan and the burn display.
   - Moving from 4.5 to 4.0 is small (about 30 kcal a day at 88 kg, 4 x 75 min), and METs may underestimate lifting [105]. Consistency is the point.
3. **Count real sessions**: use `min(trainingDays, sessionsPerWeek)`. Once at least 4 weeks of timed sessions exist, use the average of logged sessions x actual minutes.
4. **Session length**: add a field to the web form and ask it in text Coach. Say "assumed 75 min" when it is defaulted.
   - Also fix the case where a lifting-brief value of 10-14 min fails the goals schema (min 15) and silently disables Save.
5. **Cap the training term** at a plausible level **(design choice)**, for example 1,000 kcal a day. The schema currently allows 7 x 240 min, which is 1,584 kcal a day at 88 kg.
6. **Recalibrate from outcomes** (3.3).

New numbers for the six reviewed cases are 3,123 / 2,499 / 2,124 / 2,065 / 1,766 / 3,453 kcal (was 2,830 / 2,236 / 1,878 / 1,802 / 1,514 / 3,141). `tests/body-goals.test.ts` pins 2,830 and must be updated.

**Safety notes.** Low maintenance is the main reason planned EA lands below 30 for women with low everyday activity (3.3). Fix it before adding any floor.

---

### 3.3 Daily calorie target (`energy.target`)

**What it does.**
- `lib/body-goals.ts` L121-181:
  - Maintain if the goal is within 0.5 kg.
  - Otherwise `calories = maintenance -/+ rate x 7,700 / 7`.
  - Recomposition runs at 95 % of maintenance.
  - Below resting energy, calories are held at resting and a note is added.
  - The result is rounded to 10 kcal (L243).
- Goal BMI under 18.5 adds a note only (L182-186).
- `applyGoals()` saves `planTargets()` into `nutrition.targets` once (L311).
- The **saved** target drives the Food page, iPhone Ledger, Account, Trends and Coach `dailyTargets`.
- The **live** plan (`planForState`, using today's date and the newest body fat) drives:
  - the web Goals card (`components/goals.tsx` L31, L49);
  - Coach `goals.plan` (`lib/coaching.ts` L226);
  - the voice line (`lib/voice-checkin.ts` L103-105).

**What the evidence says.**

- **Rates**: the weekly rates are supported (3.4).
- **EA floors**:
  - 12 of 13 expert documents that set an EA floor for weight loss used 30 kcal/kg FFM. One allowed 20-25 for men [3].
  - The joint position links chronic EA below 30 with impairments, and advises cutting about 250-500 kcal a day for most athletes [2].
  - The IOC warns against a definitive clinical threshold and against EA-based prescription [1].
- **EA at the app's own targets** is about 24-31 kcal/kg FFM for typical lifters, mostly women. This is illustrative: it assumes body fat and uses gross training energy.
  - Much of the shortfall comes from low maintenance. At a total PAL of 1.5, a 30-year-old woman's EA moves from about 27 to about 33.
- **A simple floor.** If intake equals resting energy plus training energy, EA equals RMR/FFM, which is about 25-30 for most people. That floor needs few inputs.
- **When the floor binds.**
  - It rarely binds for heavy trainers, but does for higher-body-fat users in the 0.75 % tier.
  - When it binds, the plan still reports the old rate and weeks. A 60-year-old 50 kg woman is told 0.25 kg/week; the real figure is about 0.17.
- **No absolute minimum.** That same woman gets 980 kcal.
  - Obesity guidelines start standard prescriptions at 1,200-1,500 kcal for women and 1,500-1,800 for men, and say anything under 800 kcal needs medical supervision [30]. This is indirect evidence for lean people.
  - ISSN classes 800-1,200 kcal as a low-energy diet [19].
- **Uncertainty.**
  - Individual requirements can be misjudged by 2 MJ (about 480 kcal) or more [6].
  - Baseline needs can rarely be known better than about 5 % without doubly labelled water [27].
  - The static 7,700 kcal/kg rule over-predicts loss [28, 42]. Lean people need less energy per kg lost [25]. Early loss runs at about 4,858 kcal/kg and later about 6,041 [26].
- **Gain.** Surpluses of 145-340 kcal (5-12 %) are conservative against Iraki's 10-20 % [20] and Slater's 360-480 kcal a day [29].
- **Duration.** Fat loss belongs well away from competition, with progress expected over about 3-6 weeks [2]. "Adaptable" low EA is short-term and monitored [1].
- **Drift.** The live plan drifts as a target date nears and keeps the maximum rate after the date, while the saved target stays at the setup value. Example, 88 to 84 kg by March: 2,620, then 2,490, then 2,350 kcal.

**What to change.**

1. **Floor (design choice, anchored to [1, 2, 3, 30]):**
   - `floorKcal = max(restingKcal + trainingPerDay, 1,200 for women and unspecified, 1,500 for men)`.
   - If `floorKcal >= maintenance - 100`, plan maintenance and say so.
   - Under 18, no deficit (3.4).
2. **Soft EA check, women and unspecified only.** When a trusted body-fat reading exists, compute EA internally. Below 30, add a plan note about warning signs and set a Coach flag for a symptom check-in. Never show the EA number to the athlete [1].
3. **Deficit cap (design choice):** at most 500 kcal a day, unless body fat is at or above the sex's "higher" limit. Then allow at most 1,000 kcal a day and 1 kg a week [2, 3, 24].
4. **Recompute after every floor or cap:** `weeklyChangeKg = (maintenance - calories) x 7 / 7,700` and `weeksToGoal = ceil(|diff| / rate)`. Name the slower rate in the note.
5. **End point:**
   - Store `startDate`, `startWeightKg` and `plannedEndDate` with the saved target.
   - When the 7-day average weight is within the maintain band of the goal, or the date has passed, propose maintenance as a reviewed change.
   - Widen the maintain band to `max(1 kg, 1 % of bodyweight)` **(design choice)**.
6. **Time limit (design choice):** after 12 weeks of continuous deficit, Coach offers a maintenance block. It also offers a check-in on energy, sleep, injuries and menstrual changes (or libido in men) [1].
7. **Feedback** (thresholds are design choices; the principle comes from [9, 18, 20]):
   - After at least 3 weeks (3-4 for women, because of cycle-related weight swings) with enough weigh-ins, compare the weekly-average trend with the planned rate.
   - Propose a reviewed change of no more than about 150-200 kcal.
   - Never lower calories below the floor.
   - Never answer slow loss by cutting further without first checking whether food logs are complete [84].
8. **One number:** show the saved target everywhere, including the Goals card. Use the live plan only to propose an update (cross-cutting, 4.1).
9. **Display:** round to 50 kcal and say "about 2,350 kcal a day, a starting estimate". `describePlan` already says "about" for the rate and weeks; the kcal figure, the Goals card and the Food page do not.
10. **Weight classes:** see 3.4 and 3.17.
11. **7,700 kcal/kg:** keep it as a planning constant. The feedback loop corrects it.

**Safety notes.** Items 1-6 are safety items. The floor and EA check are guardrails built on uncertain inputs, not diagnoses.

---

### 3.4 Direction, focus, weekly rate and weeks to goal (`energy.rate`)

**What it does.** `lib/body-goals.ts` L121-168 and L247-248, with limits from `lib/body-composition.ts` `leannessLimits()` L174-180:

| Sex | Limits (essential / veryLean / lean / higher) |
|---|---|
| Men | 5 / 8 / 12 / 25 |
| Women | 13 / 16 / 22 / 32 |
| Unspecified | 9 / 12 / 17 / 28 |

- **Loss**: 0.5 % of bodyweight a week; 0.75 % when body fat is at or above "higher"; 0.4 % when at or below "lean".
- **Gain**: 0.35 / 0.25 / 0.15 % by experience.
- **Recomposition**: at most 0.25 %.
- A target date at least 7 days away limits the rate.
- All of this uses the setup weight (`profile.body.weightKg`, written only by `applyGoals` L307).
- Focus from the previous save persists when a new request has none (L299).

**What the evidence says.**

- **Loss rates are supported.**
  - 0.5-1 %/week, slower as the athlete gets leaner [18, 19].
  - 0.7 %/week beat 1.4 %/week for keeping lean mass [41].
  - At most 0.5 %/week is preferable for lean physique athletes, and 0.4-0.75 % worked in female case reports [22].
  - Under 1 %/week [2]; slower when lean [23].
- **Gain rates are conservative.**
  - 0.25-0.5 %/week with a 10-20 % surplus suits novices and intermediates; advanced lifters go lower [20].
  - A 15 % surplus added mainly fat compared with a 5 % surplus [21].
  - The app's "developing" (8.6 % surplus) and "experienced" (0.15 %/week) values sit below these ranges. That is conservative and matches the authors' advice for advanced lifters.
- **Deficit size.** A deficit of about 500 kcal a day prevented lean-mass gain during resistance training. Strength was not significantly different [24].
- **Body-fat thresholds.** The lean share of weight change depends continuously on body fat [49], and readings carry large error [47].
  - Hard thresholds turn measurement noise into step changes of 100-240 kcal. Example: an 88 kg man at 24.9 % vs 25.0 % gets 2,270 vs 2,030 kcal.
  - When the only reading ages past 90 days, the live plan silently switches equation and tier, for example from 2,030 to 2,360 kcal.
- **Large deficits for heavy athletes.**
  - At 0.5 %, the deficit is over 500 kcal a day for anyone above about 91 kg.
  - At 0.75 %, a 140 kg athlete gets 1,155 kcal a day (1.05 kg/week).
- **Weigh-ins.** Weightlifting weighs in 2 hours before the first group, so there is little time to recover from an acute cut [50]. Acute loss of 2-3 % "likely has few disadvantages"; more than 3 % "may" harm health and performance [4].

**What to change.**

1. **Current weight**: use the 7-day average of check-ins (falling back to the setup weight) for `remaining = target - W_now` and for the rate fraction.
2. **Stop at the goal**: if `|remaining|` is within the maintain band, or the date has passed, set direction to maintain with a "review your goals" note. Do the same for gain plans, which currently also continue past the goal.
3. **Short dates**: under 7 days away, say "too close to plan a safe cut" and hold maintenance, rather than silently switching to the maximum rate.
4. **Deficit cap**: apply the cap from 3.3.
5. **Smooth the tiers (design choice):**
   - `lossPct = 0.40 + 0.35 x clamp((BF - lean) / (higher - lean), 0, 1)` % a week.
   - Base it on the median of the last 3 same-method readings.
   - With only consumer-scale readings, use 0.5 %.
6. **Implied body fat**: check it at the goal weight (3.18).
7. **Display**:
   - Show the rate to 0.05 kg and as % of bodyweight a week.
   - Show weeks as a range.
   - Under 150 kcal a day of deficit, say "about maintenance; we'll adjust from your weigh-ins".
8. **Weight classes**:
   - When the athlete says so, treat the date as a weigh-in date.
   - Plan the chronic cut to **reach the class limit**, not to stop a few per cent above it. Stopping above it would build a water cut into the plan, against the app's own rule in `knowledge.ts` L134.
   - When the gap cannot be closed safely, offer a later meet, the next class up, or a talk with a coach or sports dietitian.
   - Leave any acute manipulation to them.
9. **Focus**: clear it when direction changes, or ask.
10. **Under 18 (policy):** no app-generated deficit; maintenance or slow gain; no body-fat input.
    - The AAP allows slow loss (about 0.45 kg a week) for growing athletes with excess fat [5].
    - ACSM discourages weight making in minors [4].
    - A blanket "no deficit" is a conservative rule for an unsupervised app, not an evidence mandate.
11. **Breastfeeding** [57, 58]:
    - No deficit in the first 4-6 weeks postpartum.
    - Then at most about 0.5 kg a week (about 500 kcal a day), never below the floor.
    - Add a note to watch milk supply and involve a midwife or health visitor.
    - The evidence comes from women with BMI 25-30, so apply the cap only at BMI 25 or more, or use a lower cap.
12. **Pregnancy**: no loss plan [53, 54, 55, 56].

**Safety notes.** Three items here are high-priority safety issues: anchoring to the setup weight, the missing gates for minors, and the implied body-fat check.

---

### 3.5 Protein (`protein.target`)

**What it does.**
- `lib/body-goals.ts` L187-194:
  - Losing or recomposition: 2.5 g/kg lean mass with body fat, else 2.0 g/kg bodyweight.
  - Otherwise: 2.2 g/kg lean mass or 1.8 g/kg bodyweight.
- The result is rounded to 1 g.
- There is no sex, age, training, kidney or pregnancy input.
- It is shown as:
  - "N g remaining / above target" on the web Food page (`components/views/food.tsx` L105-112);
  - 10 g marks on iPhone;
  - "Protein ... g a day" in Account.

**What the evidence says.**

- **Athlete ranges.**
  - 1.4-2.0 g/kg for most exercising people; 2.3-3.1 g/kg may be needed in hypocaloric periods; 0.25 g/kg or 20-40 g per meal every 3-4 h; trials at 3.4-4.4 g/kg found no harm [59].
  - Gains in fat-free mass level off around 1.62 g/kg (95 % CI 1.03-2.20; the breakpoint itself was not significant), with about 2.2 g/kg to maximise [60].
  - 1.2-2.0 g/kg, more when cutting energy [2].
  - 2.3-3.1 g/kg of lean mass for lean athletes in a deficit, higher when leaner [18, 19].
  - About 0.4 g/kg per meal over at least 4 meals [61].
- **Population guidance.** No adult sex difference per kg. Protein's share of energy should rise below 8 MJ. Older adults need about 1.2-1.5 g/kg. Undiagnosed reduced kidney function is common in older adults [62].
- **Obesity.**
  - Guidance that addresses scaling prefers adjusted weight (ideal weight + 0.25 x excess): 1.0-1.5 g/kg adjusted, and no reliable data above 2 g/kg adjusted [66].
  - General weight-loss trials use 1.2-1.6 g/kg of total weight [67].
  - Nothing supports 2.0 g/kg of total weight at BMI 40+.
  - NASEM's 35 % upper end complements the carbohydrate and fat ranges; it is not a safety limit [63].
- **Kidney disease.**
  - 0.8 g/kg in stages G3-G5, and avoid more than 1.3 g/kg when at risk of progression [64]. Healthy kidneys are unaffected [65].
  - Creatinine-based eGFR is less accurate in bodybuilders and extreme exercisers [64].
- **Pregnancy.** Use either the NASEM RDA of 1.1 g/kg of pre-pregnancy weight [63], or EFSA's +1/+9/+28 g a day by trimester on top of the non-pregnant intake [62]. Do not add the two. One trial linked high-protein supplements to small-for-gestational-age babies [68].
- **Adolescents.** The only youth-specific figure found was 1.2 g/kg (average) to 1.4 g/kg (recommended), in 11 boys [69]. That is weak.
- **Carbohydrate.** The IOC notes that emphasising protein during calorie restriction probably deepens low carbohydrate availability [1].

Worked numbers:

| Case | Protein | Share of energy | Other effect |
|---|---|---|---|
| 140 kg man, no body fat, losing | 280 g | 48 % | 51 g carbohydrate |
| 200 kg man, losing | 400 g | | 0 g carbohydrate; macros 3,040 kcal against a 2,940 kcal target |
| 60-year-old woman at 980 kcal | 100 g | 41 % | |

**What to change.**

1. **Obesity path (design choice, reconciling [60, 66, 67])**. When there is no trusted body-fat reading and BMI is 30 or more:
   - `W_adj = 25 x h_m^2 + 0.25 x (W - 25 x h_m^2)`.
   - `protein = clamp(1.6 x W, factor x W_adj, 2.0 x W_adj)`, with factor 2.0 when losing and 1.8 otherwise.
   - Round to 5 g and label it "estimated; add a body-fat reading for a better number".
   - Ask for a body-fat reading. With a trusted one, use the lean-mass path.

   | Case | New | Was |
   |---|---|---|
   | 140 kg / 180 cm, losing | 190 g | 280 g |
   | 200 kg / 185 cm, losing | 230 g | 400 g |
   | Muscular 105 kg / 175 cm, maintaining | 165 g (still about 1.6 g/kg) | 189 g |
   | 150 kg / 190 cm, maintaining | 210 g | 270 g |

2. **Kidney question** at goal setup: "Have you been diagnosed with kidney disease, or told by a doctor to limit protein?" If yes, set no plan protein target and say to follow the clinician's advice.
3. **Pregnancy or breastfeeding:** no app protein target. Point to the midwife or GP, and prefer food over high-protein supplements [62, 68].
4. **Under 18:** no "losing" uplift, and food-first wording. Either show no number, or a range labelled as weak evidence (about 1.2-1.4 g/kg [69]).
5. **Low training or older age (low):** with 0-1 training days, cap at 1.6 g/kg when losing and 1.2-1.5 g/kg when maintaining [62, 67].
6. **Taper (low):** 2.5 g/kg lean mass when lean, tapering to 2.2 g/kg over the 10 body-fat points above "higher" [18].
7. **Display:**
   - Round to 5 g and show "at least X g".
   - Say "reached" instead of "above target".
   - Name the basis ("2.5 g per kg lean mass from your 25 % reading").
8. **Coach:** use one range everywhere, generated from the code constants (4.9).
9. **Recompute** when the 7-day weight moves 3 % from setup, or a new body-fat basis arrives (4.1).

**Safety notes.** The obesity path is high priority for two reasons. It drives carbohydrate to zero and macros above calories (3.7), and obesity is a kidney-disease risk factor with no screen. No source shows 280 g harms healthy kidneys [65].

---

### 3.6 Fat (`fat.target`)

**What it does.**
- `lib/body-goals.ts` L226: `round(max(0.8 x setupWeightKg, 0.25 x calories / 9))`.
- The comment at L188-190 mentions only the 25 %.
- Protein switches to lean mass when body fat is known; fat does not.
- The per-kg floor wins below about 28.8 kcal per kg of bodyweight, which covers the common 88 kg cutting case.
- `tests/body-goals.test.ts` L116 pins 70 g.

**What the evidence says.**

- **Every reference gives a range with an upper end.**
  - NNR: 25-40 % of energy, saturated fat under 10 %, n-3 at least 1 % [70].
  - EFSA: 20-35 %. Intakes above 35 % can be compatible with health depending on diet and activity. EPA+DHA 250 mg a day [71].
  - NASEM: 20-35 % for adults, 25-35 % for ages 4-18 [63].
  - ACSM/AND/DC: 20-35 %, not chronically under 20 % [2].
  - WHO: 30 % or less for the general population [72].
- **The 0.8 g/kg figure does have a source, but it is used the wrong way.** ISSN gives 0.5-1 g/kg for athletes reducing body fat [74]. That is an intake to reduce towards during fat loss, for athletes. It is not a floor on total weight for people weighing 140-200 kg. Iraki presents 0.5-1.5 g/kg as roughly 20-35 % of calories [20].
- **Contest prep** uses 15-30 % fat, with 15-20 % acceptable when more fat would squeeze carbohydrate or protein [18].
- **Testosterone.** Low-fat diets (about 20 % vs 40 %) lowered testosterone modestly in near-isocaloric studies of men with a mean age of 46 [73].

Worked numbers: fat reaches 43 % of energy at 140 kg, 45 % for a 110 kg woman and 48 % at 200 kg. On their own these are not harmful (EFSA, NNR). The problem is that carbohydrate falls to 0-0.4 g/kg. Protein is the bigger cause of that (3.5): fixing fat alone still leaves the heavy cases at about 1 g/kg carbohydrate.

**What to change.**

1. `fat = round5(0.25 x kcal / 9)`, with no per-kg floor. Keeping a 0.5 g/kg reference-weight floor is harmless, but it almost never binds (0.3 % of a 256,608-plan grid).
2. In a loss phase, when carbohydrate would fall below the 130 g floor (3.7), lower fat towards 20 % of energy, **adults only**. Keep at least 25 % for 14-17-year-olds [63]. State this choice, because 20 % is below NNR's 25 % [70].
3. Show fat as a range, 25-35 % of energy (for example "45-65 g"), with "in range / below / above".
4. Add one line of fat-quality guidance to Coach: mostly unsaturated fats, saturated fat under about a tenth of energy, and fatty fish once or twice a week [70, 71].
5. Fix the comment, update L116 and L34-35, and add the grid invariant test (section 5).

**Safety notes.** The safety concern is the carbohydrate collapse and the inconsistent macros, not fat itself.

---

### 3.7 Carbohydrate (`carbs.target`)

**What it does.**
- `lib/body-goals.ts` L227: `round(max(0, (calories - 4P - 9F) / 4))`, using unrounded calories.
- There is no floor, no note, and no check that the macros add up.
- On the web, a 0 g target shows any carbohydrate as "N g above target" (`components/views/food.tsx` L214), while the bar is hidden (L38).
- It is not shown on iPhone.

**What the evidence says.**

- **The remainder method is sound.** Contest-prep guidance does the same [18]. For lean lifters at maintenance or gaining, it gives 4.7-6.0 g/kg, inside the bands for strength athletes [2, 75].
- **130 g.**
  - NASEM's RDA is 130 g a day from age 1, including 14-18-year-olds (175 g in pregnancy, 210 g in lactation), based on the brain's glucose use [63].
  - This is a US/Canadian population value. EFSA sets no minimum requirement, and EFSA and NNR use 45-60 % of energy [79, 81].
  - A 130 g planning floor is still a sensible conservative default for an unsupervised app. Call it "the generally recommended minimum", not a safety threshold.
- **Carbohydrate and lifting.**
  - ACSM's 3-5 g/kg is the band for light or skill training where training quality matters, not a minimum [2].
  - Lifters report 3-5 g/kg, and 4-7 g/kg is reasonable depending on phase. There is no conclusive evidence that a habitually high intake helps [75].
  - In the fed state, with up to 10 sets per muscle, carbohydrate intake is unlikely to change strength performance. Benefits appear with fasted training, more than 10 sets per muscle, and two sessions a day. A 3-month crossover in powerlifters and weightlifters found no 1RM difference at about 41 vs 223 g a day [76].
  - Acute carbohydrate improves session volume, especially in sessions over 45 min and after an 8-hour fast [77].
  - Higher intake did not change hypertrophy [78].
- **Very low intake.**
  - Six days under 50 g a day, with adequate energy, lowered bone-formation markers in race walkers [82].
  - The IOC notes a growing role for low carbohydrate availability [1].
  - People on SGLT2 inhibitors should avoid ketogenic eating. Very-low-carbohydrate plans are not recommended in pregnancy, lactation, children or kidney disease, or for people with or at risk of disordered eating [83].
- **Scope of the problem.**
  - In a sweep of 1,260 loss plans, 30 % came out under 130 g. For normal-weight women with low everyday activity it was 78 %.
  - A 15-year-old girl (160 cm, 55 to 50 kg, no training) gets 120 g.

**What to change.**

1. **Hard floor** `Cmin = 130 g` (175 / 210 g if pregnancy or breastfeeding is recorded), including ages 14-17.
2. **Make the macros add up.** Compute them from the **rounded** calories and enforce `|4P + 4C + 9F - kcal| <= 10`. Never clamp silently.
3. **Resolve a shortfall in this order:**
   - (a) fat down to 20 % of energy (adults only);
   - (b) protein down to 1.6 g per kg of the weight protein is based on;
   - (c) calories up, to maintenance at most. Recompute the rate and weeks, and add a note ("Carbohydrate is kept at 130 g a day; the plan loses a little more slowly").
4. **Zero targets**: treat `target <= 0` as "No daily target" in the text, as the bar and iPhone already do.
5. **Display**: round to 5 g with "about", and label it "what's left after protein and fat" in the form and Coach context.
6. **Training guidance as a Coach note only**, never an automatic step: "lifters usually do well on 3-5 g/kg; put most of it in the meals before and after sessions, at least 15 g in the 1-3 hours before; prioritise it on two-session days; more carbohydrate rarely improves strength in ordinary sessions" [2, 75, 76, 77].
7. **Diabetes medication**: a Coach line to agree any carbohydrate reduction with the diabetes team [83].
8. **Fibre**: at least 25 g a day in Coach guidance [80].

Example at today's calorie figure: a woman, 30, 65 to 60 kg, low activity, 3 x 60 min, 1,410 kcal. Now 130 P / 52 F / 106 C. With fat at 25 % of energy it becomes 130 / 40 / 135, with no further step needed.

**Safety notes.** The safety issues are zero or near-zero targets and macros above calories. The floor is a conservative default, not a physiological limit.

---

### 3.8 Manually set or Coach-set targets (`diet.manualTargets`)

**What it does.**
- `dietTargetsSchema` (`lib/nutrition.ts` L105-113) accepts calories 0-10,000, protein 0-1,000, carbs 0-2,000 and fat 0-1,000, each nullable. It also stores a maintain/lose/gain label that calculates nothing.
- The web form uses `step="0.1"` and saves without review (`components/food-forms.tsx` L202-262, `components/views/food.tsx` L507-526).
- Coach's `set_diet_targets`:
  - is always reviewed, and needs a food read first (`lib/agent/change-guards.ts` L147-148);
  - is told to save a stated number "with exactly that number, without asking" (`knowledge.ts` L132). This wording was a deliberate owner-reviewed change, pinned by `tests/coach-prompt.test.ts` around L93-97.
- `prepareDietTargets` replaces the whole object (`lib/agent/prepare-records.ts` L137).
- The receipt honestly says these are "not a calculated calorie prescription".

**What the evidence says.**

- Targets should be individual and set by trial and error [2], so storing the athlete's own numbers is right.
- Low EA can come from a "misguided or excessively rapid" weight-loss programme [2]. Problematic low EA is prolonged or severe [1].
- 800-1,200 kcal is a low-energy diet, and 400-800 a very-low-energy diet [19].
- Adult athletes generally need at least about 2,000 kcal a day, though this varies widely [5].
- 76 % of 149 adult weightlifters used chronic and/or acute weight-loss strategies to make weight. The usual final-week loss of 2-3 % was within guidelines [31].
- Energy factors are 4/4/9 kcal per gram for carbohydrate/protein/fat, and 7 for alcohol [87]. EU label rounding avoids false precision [86].
- App use is associated with disordered eating, in cross-sectional studies only [88].

**What to change.**

1. **One floor rule for plan and manual targets** (3.3). Below it:
   - show a note in the form and the review ("below your estimated minimum of about X kcal");
   - drop the "above target" text;
   - pass `targetBelowMinimum` to Coach.

   Under 800 kcal, show a stronger note ("very-low-energy range; plan it with a doctor or dietitian") and ask for a second confirmation. Notes inform; they do not block.
2. **Change `knowledge.ts` L132 only below the floor.** Still save the athlete's number, but include the app's note and ask once whether a professional is involved. Leave the owner-reviewed "without asking" behaviour unchanged above the floor.
3. **Fix the partial-update bug.**
   - Today an omitted field becomes null and the goal resets to "maintain". The web review shows this, but the iPhone receipt hides null lines and never shows the goal label.
   - Make the action schema `dietTargetsSchema.partial()` without defaults.
   - Merge `{...current, ...action.targets}`, with explicit `null` meaning clear.
   - Show every field before and after in the review, on web **and** iPhone.
4. **Consistency notes.**
   - When all four are set and the macros differ from calories by more than `max(100, 10 %)`, say "your macros add up to about X kcal".
   - With a known weight, protein under 1.2 g/kg: "below the 1.2-2.0 g/kg usually advised for athletes".
   - Protein over about 3 g/kg: "more than research shows is needed; ask a doctor if you have kidney disease". Do not say "above the studied range", since 3.4-4.4 g/kg has been studied [59].
   - Fat under 20 %: flag it "for long periods".
5. **Rate check with a "lose" label.** Use the least-squares trend (3.17), with at least 4 weigh-ins over at least 2 weeks. Above 1 % of bodyweight a week, say so.
6. **Minors and pregnancy.**
   - Under 18, a "lose" label or calories below maintenance get a note recommending a sports dietitian and a parent.
   - Coach does not prepare deficit targets for minors without that referral.
   - Treat `profile.age` of 0 (the default) as unknown.
7. **Inputs.** Use integers (kcal in steps of 10, grams in steps of 1). Store 0 as null. Confirm values under 500 kcal as a likely typo.
8. **Provenance.**
   - Store `{source: "manual" | "plan", setAt, weightKgAtSet}`.
   - The Goals card shows "Your own target: X kcal (the plan estimate is Y)".
   - Warn before goals overwrite manual targets.
   - Keep a target history, so Trends draws the target that applied each day.
9. **Do not show the athlete a computed EA number** [1, 88].

**Safety notes.** The missing floor note is the safety item. The partial-update bug is a correctness item that can silently delete a protein target.

---

### 3.9 Progress display ("980 of 1,900") (`progress.display`)

**What it does.**
- **Web Food page** (`components/views/food.tsx` L28-46, L105-112, L182-216):
  - shows "of X kcal" and a bar clamped to the target;
  - shows "N remaining" or "N above target" for kcal and every macro;
  - rounds totals only to 0.1 and prints them as, for example, "1,134.7 kcal".
- **iPhone Ledger** (`ios/LiftJournal/Design/Visuals.swift` L173-181; `IsotypeMeter.swift` L7-31):
  - draws marks of 100 kcal / 10 g / 250 ml;
  - shows "N above target" for energy only, and only when there is no Burned line.
- **Trends** apply today's water target and the current calorie target to every past day, and include today's partial day in averages (`lib/native-api.ts` L1760-1762; `TrendView.swift` L166-169).
- **Coach's progress visual** accepts any target the model supplies (`lib/coach-visuals.ts` L19-21, L55).
- **A 0 target** shows "of 0 kcal" on the web, "0 kcal a day" in iPhone Account, and a target line at 0 in iPhone Trends.

**What the evidence says.**

- **Both sides of "980 of 1,900" are estimates.**
  - Prediction equations have individual errors [12, 6].
  - Athletes' self-reported intake runs about 19 % below doubly labelled water [84].
  - AI photo estimates were about 36 % off for energy in 2024-era models (indicative only) [85].
  - Label tolerances are plus or minus 20 % [86].
- **Low EA is common.** Indicators appear in 23-79.5 % of female and 15-70 % of male athletes. Inflexible eating patterns are listed among disordered-eating behaviours [1]. IOC screening step 1 is validated questionnaires or a clinical interview, not computed EA [1].
- **Shape of targets.** Protein is a minimum with a soft plateau [59, 60]. Fat and carbohydrate are ranges [2, 7].
- **Teens.** Guidance is to focus on habits rather than weight [89]. The AAP report still gives adolescents calorie guidance, so hiding calorie numbers is a product choice, not a requirement [5].
- **Sleep and steps.** "Average" lines rather than targets fit the evidence [128, 139].

**What to change.**

1. **Targets below the floor** (3.3): no "above target" text or over-run marks, a plain note, and a flag to Coach.
2. **Low intake on complete days**: a symptom-led Coach check (energy, fatigue, injuries, menstrual changes), worded neutrally, because missed logging is the likelier cause [84]. No EA number. Use the 30 kcal/kg FFM line only as a soft, female-specific prompt.
3. **Past days**: say "under target" on complete or past days instead of "remaining".
4. **Precision:**
   - whole kcal and grams everywhere, with targets as "about";
   - "about on target" within `max(100 kcal, 10 %)`, and differences rounded to 50 kcal **(design choice)**;
   - "~" on day totals when any meal is estimated;
   - litres to one decimal on iPhone.
5. **Macros**: protein says "reached" at or over target. Fat and carbohydrate are ranges, with no "above target".
6. **Coach progress visual**: for energy, protein, carbs, fat or water, substitute the saved target. Otherwise tag it "suggested by Coach". Reject kcal targets below the floor.
7. **Trends**:
   - one shown calorie target (4.1);
   - per-day water targets (`hydrationForDay` already computes them);
   - exclude today and incomplete days from averages;
   - add a 7-day average of complete days against the target.
8. **Fixes**:
   - draw the meter's target line at its fractional position;
   - round glasses properly with `Int((Double(totalMl) / 250).rounded())`;
   - treat `target <= 0` as no target on every surface.
9. **"Burned" context**: see 3.12.
10. **Under 18**: no deficit plans and no "above target" text; hiding the calorie number is optional. **Pregnancy**: pause deficit wording.

**Safety notes.** Items 1 and 2 are the safety items.

---

### 3.10 Calories burned per activity (`burn.cardio`)

**What it does.** `lib/energy.ts` `cardioBurn()` L76-105 takes the first of:
1. A recorded `caloriesKcal` (from a watch via Apple Health, typed, or from a photo). It is treated as "measured", shown without "~", and 0 is accepted.
2. With average heart rate, age and male/female sex: Keytel 2005 without VO2max, used if the result is above 0.
3. Otherwise MET x kg x hours, from a table by activity and speed (`met()` L24-58).

Other details:
- About 26 Apple workout types, including strength, are imported as "other" at 5 MET (`HealthSync.swift` L385-420; `lib/health-sync.ts` L124).
- Weight comes from the goal-setup weight first (`bodyweightKg()` L11-20). Once goals exist, check-ins are never used, even though the comment says "latest known bodyweight".

**What the evidence says.**

- **The structure is standard.** Device value, then heart-rate equation, then Compendium METs matches how exercise energy is estimated in practice [2, 95]. The Keytel coefficients and the kJ-to-kcal conversion are correct.
- **Keytel is used outside its range.**
  - It was derived in 115 regularly exercising adults aged 18-45, during steady treadmill or cycle work at 57-90 % of maximum heart rate [91].
  - In lifting, heart rate runs at 63-82 % of maximum while oxygen use is only 33-47 %. Running- and cycling-based heart-rate equations therefore overstate lifting [92].
  - The heart-rate to energy relationship is not linear at low intensity [94].
  - HRmax is about 208 - 0.7 x age [93].
  - The "> 0" guard only fails below about 41-65 bpm, so it gives no protection.
  - Because sex comes only from goals, Keytel's age input is effectively 14-100 here.
- **Exposure is limited.** Apple Watch workouts nearly always carry their own energy. Keytel and METs mainly affect typed entries, photo logs, and apps that write no energy.
- **Wearable energy is an estimate.**
  - Apple Watch energy error is above 10 % in every subgroup of a 56-study meta-analysis [98].
  - No wrist device reached under 20 % error [101], and no brand was accurate for energy [99]. Accuracy depends on activity [100].
  - In a 34-minute resistance protocol, Apple's figure was about 2.1 times the calorimetry value according to the paper's own tables. The paper's text says "underestimated", which contradicts its tables [102].
- **Gross vs net.** Apple's active energy excludes resting energy [103]; MET figures are gross [95]. The resting share of a gross figure is 15-21 % at 5 MET and 22-30 % at 3.5 MET.
- **Compendium values.**
  - Most app METs are within about 10-25 % of the Compendium.
  - "Other" at 5 MET is far off for Pilates (2.8), stretching (about 2.3) and jump rope (about 11) [95].
  - Cycling at 14-16 km/h uses code 01010 (4.0, "leisure, to work"), which is a legitimate choice. The real defect is a 70 % jump at exactly 16 km/h.
  - Youth and older adults have their own Compendium values [96, 97].

**What to change (in priority order).**

1. **Stop calling watch energy "measured".**
   - Use the method "from your watch/device" and show it as "~612 kcal · watch".
   - Set `calories_estimated` true (or add a `calories_source` field), so Coach says "about".
   - Treat 0 kcal on a workout of 5 minutes or more as missing.
2. **Use Keytel only when it fits.** All of these must hold; otherwise use METs.
   - Continuous cardio: running, cycling, rowing, elliptical, walking, hiking.
   - Known sex, and age 18-45 (46-65 only as a labelled extrapolation).
   - At least 10 minutes.
   - Average heart rate between 0.60 and 0.90 x HRmax, where HRmax is the larger of the recorded maximum and `208 - 0.7 x age`.

   Drop the "> 0" rule, and reject an average heart rate above HRmax (the schema allows 300). A 0.67-1.5 cross-check against the MET figure is optional **(design choice)**.
3. **Map Apple "other" titles to Compendium values:**
   - Pilates 2.8; flexibility, cooldown and recovery 2.3; core 3.8; mixed cardio 7.3; jump rope 11.0; football 7.0; tennis 6.8; badminton 5.5; cross-country skiing 8.5; downhill skiing and snowboarding 6.3; golf 4.3; dance 5.0; strength 5.0.
   - Martial arts 7.5, climbing 7.0, cross training 6.0 and boxing 7.0 are interpolations **(design choice)**.
   - Add Danish title words (styrke, cirkeltræning, udstrækning, mobilitet, spinning, cykel, trappe).
   - Smooth the cycling bands around 16 km/h.
   - Real stairs should get 6.8, not the stair-machine 9.3.
4. **Gross vs net**: make them consistent across cardio **and** strength (3.11, 3.12).
5. **Weight for a date**: the latest check-in within 30 days on or before it, then Settings, then the setup weight **(design choice)**. Fix the comment.
6. **Rounding and plausibility**: round to the nearest 10 kcal **(design choice)**. Check cardio over 6 hours, or MET energy over 3,000 kcal.
7. **Keytel with VO2max is optional only.** The app does not import VO2max, and Apple's value is itself an estimate.

**Safety notes.** Low. Burned calories never change targets, and Coach says "about". The remaining risk is an athlete eating back an inflated figure on their own.

---

### 3.11 Calories burned in a lifting session (`burn.strength`)

**What it does.**
- `lib/energy.ts` `strengthBurn()` L107-124: `round(5 x kg x minutes / 60)` when both `startedAt` and `finishedAt` exist and the span is 10-240 minutes, else null. It is always marked an estimate.
- The comment cites "vigorous" resistance training, which is code 02050 at 6.0 MET. 5.0 MET is actually code 02052 (squats, deadlift, slow or explosive) [95].

Duration problems found in the code:
- **Start time.** `startedAt` is when the draft was created (`lib/domain.ts` L133; `lib/training.ts` L33; Coach `start_routine` and similar), not when lifting began. A draft opened the day before returns null; one opened 1-3 hours early is inflated.
- **Edits.** Editing from History re-stamps `finishedAt` at the edit (`components/views/history.tsx` L181-186; `lib/domain.ts` L161). A 90-minute session edited 2 h 15 min later becomes 225 minutes, which is 1,650 kcal for 88 kg instead of 660.
- **Coach and merges.** Coach `log_workout_progress` with a session id deletes and re-stamps `finishedAt` (`lib/agent/prepare-workouts.ts` L131-135). Merges span the gap between sessions (`lib/workout-continuity.ts` L90, L120-123).
- **No start time at all.** Sessions Coach logs from chat, voice or photos have no `startedAt`, so they never get an estimate. That includes live set-by-set logging.
- **Apple imports.** An Apple strength workout imported while the session is still a draft is counted as well (`lib/health-sync.ts` L197-198 checks only finished sessions). A genuinely separate watch workout on a day with a logged session is dropped.

**What the evidence says.**

- **Measured sessions** [105]:
  - Resistance sessions span about 3-8 MET, with the top end in circuits with little rest.
  - Compendium METs apply to active time, excluding rest between sets.
  - Indirect calorimetry misses part of the anaerobic cost.
  - Wearables are 15-57 % off in resistance training [105, 107].
- **Weightlifting with long rests.**
  - A heavy-load session with 45-60 s rests came out at about 3.4 MET gross [106].
  - Another calorimetry protocol gave about 3.4 kcal/kg/h for a whole session [102].
  - There is no calorimetry for whole Olympic-lifting sessions.
  - So 5 MET is defensible, but probably at the generous end.
- **Net energy** matches Apple's definition [103]. The current EA definition subtracts more (RMR plus non-exercise activity) [32], and there is no universal EA protocol [33].
- **Individual estimates.** Cost tracks lean mass and lifted volume more than total mass [108]. The Compendium is built for consistent coding, not precise individual estimates [95].

**What to change.**

1. **Duration (main fix):**
   - start the clock at the first logged set;
   - save `durationMinutes` at the first finish, and never re-stamp it on edits or appends;
   - on a merge, add up the source durations, or use the earliest start and latest finish only when the gap is under 30 minutes;
   - let Coach and voice record a stated duration;
   - label untimed sessions "duration not recorded", so day totals do not silently leave lifting out.
2. **Double counting:**
   - defer importing an Apple strength workout while a same-date draft is open (write no "skipped" receipt), and reconcile when the session is finished;
   - store the Health workout's start and end at import, so overlap can be matched later.
3. **Net values, together with cardio:** `(5 - 1) x kg x h = 4 kcal/kg/h`, which is 530 kcal for 88 kg over 90 minutes. Changing strength alone would create a new inconsistency, because the cardio MET and Keytel estimates are also gross.
4. **Uncertainty:** say "rough", give Coach a range of about 2.5-4 kcal/kg/h net (3.5-5 MET gross) **(design choice)**, and round to 10 kcal.
5. **Small fixes:** cite 02052 in the comment, and use the latest check-in weight (3.10).

**Safety notes.** Low, because the figure never changes targets. Medium priority, because inflated or missing durations can multiply the figure or erase it.

---

### 3.12 "Burned" on Today (`burn.today`)

**What it does.**
- `lib/energy.ts` `burnedToday()` L151-168 uses Apple Health active energy for the date when present, marked as not estimated, so no "~". Otherwise it uses `dayBurn()` (L127-141), the sum of the cardio and strength estimates.
- **Web Today** shows "Burned ~N kcal" only when the figure is estimated (`components/today.tsx` L36, L114-133).
- **iPhone Ledger** shows "Burned N kcal" with no source note, and hides "N above target" when a Burned figure exists (`TodayView.swift` L220; `Visuals.swift` L173-181).
- **iPhone Steps cell** can show **yesterday's** "kcal active" with no date (`lib/native-api.ts` L812-814; `TodayView.swift` L253-254).
- **Coach** gets `burnedInTraining` from `dayBurn` (`lib/journal-summary.ts` L196-200), not the figure Today shows. It is told Apple Health active energy is a "recorded measurement" (`knowledge.ts` L130).
- **Staleness.** Active energy is not on HealthKit background delivery (`HealthSync.swift` L531-537), so today's value can be stale.

**What the evidence says.**

- **Who misses lifting.**
  - Without a watch, the iPhone estimates active calories from steps, distance and flights climbed [104], so a lifting session is mostly missed.
  - With a watch, Apple probably overstates lifting rather than missing it [102].
  - Lifters often take the watch off, or cover it, for snatches and cleans.
- **Device energy is an estimate** with large error [98, 100]. Active energy excludes resting energy [103]; app estimates are gross [95]; the current EA definition uses net exercise energy [32].
- **Exercise-energy figures carry large error**, which is why they should not feed EA arithmetic [1, 33].
- **Trackers.** Tracker use is associated with disordered eating in cross-sectional studies, not experiments [90].

**What to change.**

1. **Mark device energy as an estimate.**
   - Set `estimated: true` for Apple Health and watch energy, and keep the source ("Apple Watch" or "iPhone").
   - Show "~" everywhere and add the source note on iPhone.
   - Change `knowledge.ts` L130 so steps and heart rate are device measurements, while active energy is Apple's estimate.
2. **Do not let Apple's figure silently replace lifting it never saw.** Either:
   - show two lines, "Active energy (Apple Health) ~N so far" and "Training ~M est."; or
   - add the net training estimate only for sessions whose time window has no Apple Watch active-energy samples.

   A plain `max(apple, training)` is not supported, because it under-counts for iPhone-only lifters.
3. **Net values** for every app estimate (3.11). Label typed values "as entered".
4. **One figure for Coach.** Give Coach the same figure Today shows (kcal, source, estimated, "so far", last sync time), next to a net training figure, and put it in `describeDay`.
5. **Context.**
   - Add a line: "Doesn't include the energy your body uses at rest."
   - Keep the iPhone "N above target" text alongside Burned.
   - Never show intake minus burned, or an EA number.
6. **Small fixes.** Label the Steps cell "Yesterday" when it falls back. Clamp active energy to 0-10,000 kcal a day and flag values above 6,000 **(design choice)**.

**Safety notes.** There is no direct safety failure, but the framing matters for weight-class athletes.

---

### 3.13 Daily water target (`water.target`)

**What it does.**
- **Formula.** `lib/hydration.ts` `hydrationTargetMl()` L58-70:
  - `35 ml x weight`, or 2,500 ml without a weight;
  - plus `(sessionMinutes ?? 75) / 60 x 600 ml`, once, if any strength session or the open draft is dated that day;
  - rounded to 50 ml, and marked "estimated" only when there is no weight.
- **Weight** is the setup weight first (`lib/energy.ts` `bodyweightKg`).
- **Gaps in the training add-on.** Cardio adds nothing. Actual durations are not used. Apple Watch strength workouts are imported as cardio, so they never trigger the add-on.
- **Typos.** The Settings weight accepts 0-1,000 kg (`lib/model.ts` L136), so a typo gives anything from 0.3 to 35.75 L.
- **Display**:
  - "aim for about X L" on the web;
  - "N of M glasses" and two-decimal litres on iPhone;
  - "Water X L a day" in Account;
  - today's target on every day in Trends (`lib/native-api.ts` L1762).
- **Reminders.** Optional iPhone reminders at 11:00, 14:00 and 17:00 nudge when intake is below 35 / 60 / 80 % of the target (`Reminders.swift` L80-117).
- **Footer.** The Account footer says Coach can change these targets, but no action can change the water target.

**What the evidence says.**

- **No authority sets a per-kg drinking target for healthy adults.**
- **Total-water adequate intakes:**
  - EFSA and NNR: 2.5 L (men) and 2.0 L (women) from age 14, at moderate temperature and PAL 1.6, including food moisture [110, 111].
  - NASEM: 3.7 / 2.7 L, of which beverages are about 3.0 / 2.2 L [109].
  - Adequate intakes are typical intakes, not requirements. Thirst plus drinking at meals keeps healthy people hydrated day to day [109, 112].
  - Danish advice: 1-1.5 L of drinks is usually enough, more when active or sweating [113].
- **Body size.**
  - Water turnover rises only about 14 ml per kg of bodyweight (about 37 ml per kg of FFM). It falls with body fat, and is about 1 L higher in athletes. The study measured turnover, not need, and its equation explains 47 % of the variance [114].
  - Fat-free mass is 70-75 % water; fat tissue is 10-40 % [109].
  - Clinical per-kg fluid rules are adjusted for obesity [116].
- **Training.**
  - Sweat rates range 0.3-2.4 L/h. Keep losses under about 2 % of bodyweight, and weigh before and after training [2].
  - Individualise (NATA, SOR B). Do not drink more than exercise losses (SOR A). Thirst becomes less sensitive after about 50 (SOR A) [115].
  - Hypohydration lowered strength by about 5.5 % in a meta-analysis [122], so dehydrating to make weight is not free.
  - No measured sweat-rate study exists for Olympic weightlifting. 0.6 L/h is plausible but weakly supported.

Assessment:
- **Where it fits.** 35 ml/kg from drinks matches NASEM beverage intakes at typical weights (60 kg: 2.1 L vs 2.2 L; 86 kg: 3.0 L vs 3.0 L). It suits active lifters of about 55-95 kg.
- **Where it is high.**
  - It is 0.5-1.4 L above EFSA/NNR once those are converted to drinks, which makes it high for non-lifters.
  - It is far too high for heavy users: 4.9 L on a rest day at 140 kg, against about 3.3-3.8 L predicted.
  - An 88 kg man's lifting-day target (3.85 L from drinks) implies more total water than EFSA's 95th percentile of observed intake for men (4.0 L).

**What to change.**

1. **Reshape the base (design choice, calibrated against [109, 110, 114]):** `drinksBase = 1,200 + {male 240, unspecified 120, female 0} + 9.5 x kg`, clamped to 1,500-4,500 ml, then add measured training.

   | Case | New (rest day / lifting day, 75 min) | Now |
   |---|---|---|
   | 60 kg woman | 1.75 / 2.5 L | 2.1 / 2.85 L |
   | 88 kg man | 2.25 / 3.0 L | 3.1 / 3.85 L |
   | 140 kg man | 2.75 / 3.5 L | 4.9 / 5.65 L |
   | 49 kg woman | 1.75 / 2.5 L | 1.7 / 2.45 L |

   A simpler alternative is to scale from the app's maintenance energy, roughly 0.8-0.95 ml per kcal from drinks [109, 114]. Either way, apply the 1.5-4.5 L bounds on every weight path, including Settings.
2. **Training add-on:**
   - 600 ml per hour of actual training that day: strength (from the corrected duration), cardio, and imported strength workouts;
   - capped at 2,000 ml unless a measured sweat rate exists;
   - offer a sweat-rate check: `((pre - post kg) + drinks L - urine L) / hours`.
3. **Display:**
   - a range of about plus or minus 0.5 L, with a 1.5 L lower end, rounded to 0.25 L;
   - labelled "from drinks" and as an estimate;
   - one decimal on iPhone, and "rest day / lifting day" in Account;
   - a cue line ("thirst and pale urine are good everyday signs"), with an age caveat because thirst blunts after about 50 [115].
4. **Coach rule:**
   - the target is not a minimum;
   - if behind, drink to thirst, with no catch-up drinking;
   - a clinician's fluid limit overrides the app;
   - water loading or restriction for a weigh-in goes to a sports dietitian.
5. **User control.** Let users hide the target or set their own. Fix the Account footer. Drive reminders from the lower end of the range, and respect a hidden target.
6. **Trends:** per-day targets.
7. **Pregnancy and lactation**, if a status is added: about +300 / +700 ml of total water [110], which is about +250 / +550 ml from drinks.

**Safety notes.** For a healthy 140 kg adult, 4.9 L spread over a day carries little overdrinking risk, given the kidney's 0.7-1.0 L/h capacity [109]. The safety items are implausible-weight extremes and people with clinician fluid limits.

---

### 3.14 What counts towards hydration (`water.intake`)

**What it does.**
- `lib/hydration.ts` L7-27 and L74-89 count every drink kind 1:1 by volume: water, sparkling, coffee, tea, energy, sports, milk, juice, soft drink, protein shake and other, 10-5,000 ml each.
- If a day has no drinks, a legacy check-in `waterMl` counts. The web check-in still shows "Water today" (`components/health.tsx` L165), which is silently ignored once any drink exists.
- Coach defaults are glass 250, bottle 500, can 330 and shake 300 ml, saved as if exact (`knowledge.ts` L135).
- There is no alcohol kind.
- Each drink's `at` is the logging time in UTC, not when it was drunk.
- Reminders are opt-in (`Reminders.swift` L17).

**What the evidence says.**

- **Most drinks count.** Beverages of all kinds count towards water [109, 113].
  - Habitual moderate coffee hydrates like water [118].
  - Caffeine's small diuresis (about 109 ml pooled) is not significant during exercise [119].
  - Of 13 drinks tested, only milk and oral rehydration solution differed from water, and they were retained better [117].
- **Alcohol.**
  - NASEM counts alcoholic drinks as water [109].
  - Wine and spirits caused about 30-35 ml of extra urine over 4 hours per 30 g of alcohol in older men, with no difference at 24 hours. This was an industry-affiliated study [120].
  - NATA advises against stronger drinks for fluid replacement (SOR B) [115].
- **Overdrinking.** Exercise-associated hyponatraemia is mainly caused by drinking hypotonic fluid beyond losses (grade 1A). Maximum urine output is about 0.8-1.0 L/h, and drinking to thirst limits overdrinking [121].
- **Weight classes.** Guidance on water loading and restriction comes only from combat sports [51, 52]. Applying it to a 2-hour weigh-in is an extrapolation.
- **Status markers.** Urine colour and thirst are personal cues (SOR C). Body-mass change needs a 3-day baseline [115].

**What to change.**

1. **Keep 1:1 counting.** Define the target as a drinks target (3.13), and label it "Drinks" on iPhone too (the web already does).
2. **Alcohol:**
   - add beer, wine and spirits (or alcohol with ABV);
   - count beer up to about 5 % at its volume;
   - record wine and spirits, but never let Coach suggest them for rehydration;
   - require a meal entry for every alcoholic drink (7 kcal/g) [87].

   Do not set wine and spirits to zero fluid; that goes beyond the evidence.
3. **High intake:** add a gentle "that's a lot; drink to thirst" note when the day total is at least `max(1.75 x target, 6 L)` **(design choice)**. A rate-based check needs a "consumed at" time first: add an optional time to `log_drink`, and exclude rough day totals.
4. **Weight class:** keep Coach's existing refer-out rule (`lib/lifting-resources.ts` L94). Pausing reminders needs a weigh-in field, and should last only until the weigh-in time.
5. **Status markers (low priority):** optional thirst and urine-colour self-checks, and the pre/post-session sweat-loss calculation. Do not flag "dehydration" from one morning weight. Coach's rule against inferring dehydration from a single weight (`knowledge.ts` L130) is correct.
6. **Legacy field:** remove it and migrate old values once into a single "from check-in" drink. Store `estimated: true` on defaulted volumes.
7. **Under 18:** energy drinks are shown, with a one-time note (3.21).

**Safety notes.** Low to medium. Reminders are opt-in, so their reach is limited.

---

### 3.15 Sleep (no target) (`sleep`)

**What it does.**
- There is no target in code, only a 14-day average of logged nights (`lib/health.ts` L241, L283-289).
- **One Coach opening**, "sleep-change", fires when the last 3 nights average at least 1 hour below 4 or more earlier nights (`lib/coaching.ts` L119-141). It is shown only on the web (`components/coach-opening.tsx`), never on iPhone.
- **The iPhone standfirst** compares last night with the week (`DaySummary.swift` L80-88).
- **Coach** knows the CDC adult figures only (`knowledge.ts` L138), and "7-9 hours" for fat loss (L134).
- **Voice** may remark on "a third short night in a row", with no data to check it (`lib/voice-checkin.ts` L144).
- **The Apple Health import** merges naps and all sources between noon and noon (`lib/apple-health.ts` L26-78). This goes against Coach's own rule not to combine naps without asking (L137).

**What the evidence says.**

- **Durations.**
  - Adults 18-60: 7 hours or more. More than 9 may suit young adults, people recovering from sleep debt, and people who are ill [124, 123].
  - NSF (reaffirmed June 2026) and Sundhedsstyrelsen: 7-9 h for adults, 8-10 h at 14-17, 7-8 h at 65+ [126, 127].
  - Teens 13-18: 8-10 h per 24 h. Regularly sleeping less, or more, is linked to harm [125].
- **Athletes.**
  - Athletes often sleep under 7 h [128]. Elite athletes averaged 6.8 h, and 6.5 h in individual sports [129].
  - A single 7-9 h rule is unlikely to be ideal. Individualise by perceived need, screen and refer persistent problems, and be aware that some athletes get anxious about tracker data [128].
- **Effects of short sleep.**
  - Sleep loss of 6 h or less in 24 h lowered performance by 7.56 % and strength by 2.85%, mostly in single-night protocols [130].
  - Adolescent athletes sleeping under 8 h were 1.7 times as likely to have been injured. This is observational [132].
  - In one 14-day trial of 10 sedentary overweight adults, short sleep during calorie restriction shifted loss from fat to fat-free mass [131].
- **Measurement.**
  - Self-report runs higher than actigraphy (6.8 vs 6.0 h, r 0.47) [133].
  - Actigraphy needs more than 7 nights for a reliable mean [134], so comparing 3 nights with 4 is noisy.

**What to change.**

1. **Teens (high, cheap):** add "13-17: 8-10 h per 24 h (CDC, AASM; Sundhedsstyrelsen 14-17)" to `knowledge.ts` L138. Never call 7 h enough for a minor.
2. **Chronic short sleep:** add a "sleep-short" Coach opening that can be dismissed and does not repeat daily. Thresholds are a **(design choice)**:
   - at least 5 nights logged in 14 days;
   - mean under 7.0 h (adults or unknown age) or 8.0 h (14-17);
   - firmer wording under 6.0 h.

   Show it on iPhone too.
3. **sleep-change rule:** also fire when the last 3 nights average under 6.0 h, with its own wording. Compare only nights from the same source, or say the sources differ.
4. **L134 (adults):** "at least 7 h; 8-9 h or more is fine, and naps can help in hard blocks".
5. **Cut link:** when a loss plan is active and sleep is short (for example under 6 h), Coach may say short sleep during a cut "may make more of the loss come from lean mass", as a possibility.
6. **Referral** [124, 128]: suggest a GP or sleep specialist for:
   - persistent trouble falling or staying asleep;
   - loud snoring or pauses in breathing;
   - marked daytime sleepiness;
   - a 14-day mean under 5 h, or over about 11 h in adults (about 10-11 h in teens) **(design choice for the cut-offs)**.
7. **Voice:** compute a short-sleep flag on the server and pass it in context.
8. **Averages:** only from 5 or more nights, shown with the count, in hours and minutes. Round differences to 15 minutes with "about".
9. **Apple import:** one source per night (prefer Apple Watch). Keep naps separate, or label the 24-hour total.
10. **Trends band:** any "7-9 h" band should be optional and quiet [128].

**Safety notes.** Teen guidance is the high item. The rest is medium or low.

---

### 3.16 Steps and activity (no target) (`steps.activity`)

**What it does.**
- Apple Health steps and active energy are stored (`lib/health.ts` L63-74) and averaged, with no target.
- The web says "not a target or a readiness score" (`components/cardio.tsx` L486-488).
- Active energy is shown as an exact integer and treated as measured (`lib/energy.ts` L151-168).
- Coach's fat-loss guidance lists "daily steps" with no framing (`knowledge.ts` L134), and cites the UK NHS 19-64 page with no numbers (L138).
- Goal setup never uses measured steps.

**What the evidence says.**

- **Activity guidelines.**
  - WHO: adults 150-300 min moderate or 75-150 min vigorous activity a week, plus muscle strengthening on 2 or more days. Older adults add balance work on 3 or more days. Ages 5-17: an average of 60 min a day. Pregnancy: at least 150 min, if there is no contraindication. WHO sets no step target [135].
  - Danish Health Authority: adults at least 30 min a day, with strength training twice a week [138].
  - NNR sets no activity guideline of its own and defers to these [137].
- **Steps and PAL.** Steps and questionnaires are both only weakly related to an individual's PAL. NASEM's advice is to estimate, then monitor weight [9].
- **Step numbers.**
  - Mortality benefit levels off at about 6,000-8,000 steps (60+) and 8,000-10,000 (under 60). Devices can differ by 20 % or more [139].
  - 7,000 a day is a realistic target for many [140].
  - Cycling and swimming produce no steps [141].
  - Device step counts are moderately accurate, though thinly validated. Device energy figures are often 20 % or more off [142].
- **Dieting.**
  - NEAT falls during restriction. Intake or expenditure may be adjusted to reopen a deficit [17].
  - Exercise beyond assigned training to make up for intake is a disordered-eating behaviour [1].
  - Pedometer walking without a diet change gave only about 0.05 kg of loss a week [143].

**What to change.**

1. **Replace "daily steps" in L134:** keep everyday movement near the athlete's usual level, since it tends to drift down when dieting. Count any deliberate extra walking inside the planned deficit, never on top of it to make up for food or hit a number. Propose a step quota only when the athlete asks **(design choice)**.
2. **Active energy:** mark it as an estimate (3.12).
3. **Guidelines:** replace the NHS reference [136] with WHO 2020 and the Danish Health Authority, banded by age (adults, under 18, 65+, pregnancy). When age is unknown, give general adult guidance labelled as general.
4. **Coach context for "how many steps?":** most benefit comes by about 7,000-8,000 a day (6,000-8,000 at 60+); devices differ by 20 % or more; 10,000 is not required. Show no progress bar for steps against a number the athlete did not set.
5. **Optional goal-setup hint from steps (design choice), only in one direction.**
   - Prompt when steps suggest more activity than the athlete chose, never less, because bike commuters log few steps.
   - Take it from rest days.
   - No hint under 18.
6. **Averages:** exclude today's partial day (cross-cutting).

**Safety notes.** Nothing here is directly unsafe. The indirect risks are step quotas during cuts, and maintenance set too low.

---

### 3.17 Goal weight and weight trend (`bodyweight.goal`)

**What it does.**
- Goal weight is 30-300 kg (`lib/body-goals.ts` L19-20); age is 14-100 (L16).
- A goal BMI under 18.5 adds a note, but the plan is built anyway (L182-186). Current BMI is never checked.
- `weightTrend()` (`lib/body-composition.ts` L147-170):
  - takes only the first and last check-in in 28 days;
  - can work from as few as two weigh-ins 7 days apart;
  - rounds to 0.01 kg.
- **iPhone Body section** (`lib/native-api.ts` `bodyForToday` L721-749):
  - shows the weight with no date;
  - computes lean mass from a body-fat reading up to 90 days old and a weight up to 30 days old.
- Apple Health body mass is not imported.
- The trend is never compared with the plan.

**What the evidence says.**

- **BMI cut-offs.**
  - Adult underweight is BMI under 18.5 [35].
  - BMI under 17.5, or under 85 % of expected weight, is a high-risk indicator. Use serial measurements, and note that weight and BMI can stay stable during energy deficiency [37].
  - BMI under 17.5 in a skeletally mature adolescent warrants evaluation [5].
  - Ages 10-19: BMI-for-age below -2 SD [35]. Cole 2007 gives age- and sex-specific cut-offs; WHO -2 SD matches Cole grade 2 [36].
  - Older adults: BMI under 22 at 70+, and loss of more than 5 % in 6 months, are malnutrition criteria within a fuller diagnosis [38]. The lowest-mortality BMI is higher in older people, though the data are weak [6].
- **Noise.**
  - Day-to-day body mass varies by about 0.5 kg even under controlled conditions [39], with a 0.35 % weekly cycle [40].
  - In simulation, for a real loss of 0.5 kg/week, two weigh-ins 7-10 days apart gave a weekly-change spread of about 0.6-1.0 kg, and the wrong direction in 21-31 % of runs.
- **Adjusting.** Weight responds slowly to intake changes [27], and static rules overestimate loss [42]. Adjust from observed rates [18, 20].
- **Pregnancy.** Gain is recommended for every BMI class [53, 54, 56].

**What to change.**

1. **BMI gates (adults):**
   - Goal or current BMI under 17.5: no loss plan. Hold at maintenance and show the doctor/dietitian message.
   - 17.5-18.5: build the plan only after explicit confirmation, at a rate of at most 0.5 % a week **(design choice)**.
   - Current BMI under 18.5 with a falling trend: show the note on Today and Body, and in Coach context.
   - Age 70 and over: a soft note when BMI is under 22, or weight has fallen more than 5 % in 6 months [38].
2. **Minors:** switching the note to Cole or WHO cut-offs makes it more accurate but fire less often, because the adult 18.5 line sits above Cole grade 1 at 14-17. That is not a safety gain. The real safety change is no app-generated deficit under 18 (3.4).
3. **Trend estimator:**
   - Use a least-squares slope over 28 days. Require at least 4 readings spanning at least 14 days; otherwise say "Not enough weigh-ins for a trend yet".
   - `b = 7 x sum((t - t_mean)(w - w_mean)) / sum((t - t_mean)^2)` kg a week, with its standard error.
   - Report a fitted trend weight, and the slope to 0.1 kg a week and as % of bodyweight.
   - Say "about stable" when `|b| < 2 x SE`, or under 0.1 kg a week.
   - On iPhone, compare 7-day averages when each week has at least 3 readings.
4. **Trend against plan (design choice anchored to [2, 5]):**
   - After at least 3 weeks, show on track / slower / faster.
   - Amber when loss exceeds 1.0 % of bodyweight a week for 3 weeks.
   - Red above 1.5 % a week over 2 weeks.
   - These complement a symptom check; they do not replace it [37].
5. **Goal reached:** propose maintenance (3.3).
6. **Weigh-in model:**
   - add an optional class limit and weigh-in date;
   - plan the chronic cut to reach the limit, and warn when the required rate exceeds the cap;
   - never plan the acute part, and refer to a sports dietitian (`lifting-resources.ts` L94 already says this).

   Practice data (2-3 % in the final week [31]) describe what lifters do, not a guideline.
7. **Data quality:**
   - import HealthKit body mass, one per day, morning preferred;
   - add a one-line hint: morning, after the toilet, before food, same scale;
   - keep daily weighing opt-in;
   - show the weigh-in date when it is not today;
   - pair lean mass with a weight within 7 days, and round it to whole kg as an estimate;
   - show body-fat date and method (the API already sends them).

**Safety notes.** BMI gates, minors, pregnancy and the trend estimator are high priority.

---

### 3.18 Target body fat and readings (`bodyfat.goal`)

**What it does.**
- Readings are accepted from 3-70 % and targets from 3-60 % (`lib/body-composition.ts` L20, L43).
- Notes (`lib/body-goals.ts` L207-225):
  - Below `essential`: "below the essential fat the body needs ... isn't a safe goal".
  - Below `veryLean`: "a short peak at most".
- Weight at target = `LBM / (1 - target/100)`, shown to 0.1 kg, using the setup weight.
- Unsafe targets are saved, and later shown in iPhone Account and Today without the warning. Coach does see the notes.
- Readings from the web goals form and Coach `set_body_goals` are saved with no method (L285-290).
- Apple Health imports the day's most recent reading (`HealthSync.swift` L257).
- There are no age-specific limits.
- The goal weight is never checked against lean mass.

**What the evidence says.**

- **The formula** is exact under constant lean mass. It matches the NCAA lowest allowable weight (fat-free weight / 0.95) [5]. NATA's own formula is slightly more conservative [43].
- **NATA** [43]:
  - Essential fat is about 3 % (men) and 12 % (women).
  - The lowest reference values are 5 % and 12 % for adults, and 7 % and 14 % for adolescents.
  - The lowest safe weight is the weight at the low-reference body fat (Rec 1, grade B).
  - Measurement error: DXA plus or minus 1.8, skinfolds 3.5, BIA 3.5-5 points.
  - Measure about twice a year.
- **Other guidance.**
  - A minimum competition weight from body composition is a listed safety strategy, and the statement covers weightlifting [4].
  - There is no single rigid optimal body composition; set goals as ranges [2].
  - Under 18, body composition should be assessed only for medical purposes [1]. There are no established adolescent targets [5].
- **Very lean athletes.**
  - A female minimum of 12-14 % has been suggested, depending on method. Some female athletes hold 10-15 %. Menstrual irregularities were 63 % vs 30 % [44].
  - A single-case study showed large hormonal, heart-rate and mood costs at contest leanness [45].
- **Measurement error.**
  - Consumer smart scales underestimated fat by 2-4 kg against DXA [46].
  - BIA limits of agreement are 15-20 points [47].
  - A meal adds 0.8-1.7 points [48].
  - "Doubly indirect" methods are not valid [1].

Worked examples, from the real code:
- A man at 90 kg and 20 % sets a 70 kg goal, below his 72 kg lean mass. He gets no note and a 45-week plan.
- A woman at 64 kg and 22 % sets a 52 kg goal, implying about 4 % body fat. She gets only "you are already lean".
- A 3 % reading artefact on an 80 kg man adds 280 kcal and 21 g protein to the live plan.

**What to change.**

1. **Under 18:**
   - ignore and hide target body fat, and compute no weight at target;
   - keep body fat out of the energy and protein formulas;
   - tell Coach not to set or discuss body-fat targets with minors, and to suggest involving a parent, coach or doctor;
   - if readings are logged anyway, warn (do not block) when a goal weight implies less than 7 % (boys) or 14 % (girls).
2. **Minimum-weight check**, when a trusted reading is paired with a weight within 7 days:
   - compute `impliedBF = 100 x (1 - LBM / goalWeight)` from the point estimate, worded "about";
   - goal below lean mass: "below your lean mass; not reachable without losing muscle";
   - implied body fat below the minimum (5 % men, 12 % women; for unspecified sex, name both): warn, and plan only down to the weight at the `veryLean` limit;
   - below `veryLean`: show the short-peak note even when no target is set;
   - use the method error only to soften the wording near the floor.
3. **Wording:** say "below the lowest healthy level (about 5 % for men, 12 % for women)" instead of "essential fat".
4. **Below-minimum targets:** require explicit confirmation, show no weight at target, and add a persistent caution marker in Account and on Today.
5. **Pairing and precision:**
   - compute lean mass from a weight within 7 days of the reading;
   - show weight at target as a whole-kg range using method error: DXA 2, calipers 3.5 and scale 4.5 points come from NATA; tape 4 and "estimate" 6 are judgement values;
   - flag a mismatch only outside that range.
6. **Which readings drive the plan:**
   - first add a method choice to the web goals form and Coach `set_body_goals`;
   - then use only DXA, BodPod, trained calipers, or the median of at least 3 scale readings within 14 days, in formulas **(design choice)**;
   - exclude readings below 5 % (men and unspecified sex) and below 12 % (women) from calculations, labelled "unusually low, check the method";
   - import the first reading of the day from Apple Health.
7. **Very-lean note:** add warning signs and a way out: "Get support if periods stop or become irregular, sex drive or morning erections drop, sleep, mood or training fall off, or you get a stress fracture; plan a return to maintenance, as recovery takes months" [1, 44].
8. **Display:**
   - method and date on iPhone ("18 % · scale · 12 Sep");
   - whole percent for scale and tape readings;
   - change computed within one method only, including Coach's "+X points since" card (`prepare-records.ts` L171-175).
9. **Coach:**
   - talk about body fat in ranges with method error;
   - treat it as private health data;
   - do not push a leaner target when an athlete voices body dissatisfaction;
   - describe photos as progress photos, not body-fat estimates (L133 and L134 currently disagree).
10. **Low priority:** a gentle note at age 50+ for targets under 10 % (men) or 20 % (women); pause body-fat targets in pregnancy.

**Safety notes.** Minors and the minimum-weight check are high priority.

---

### 3.19 Training sessions per week (`sessions.perWeek`)

**What it does.**
- `lib/body-goals.ts` L228-233: `min({new 3, developing 4, experienced 5}, max(trainingDays, 2))`.
- When more days are available, it says "N sessions a week is plenty at your level".
- **Brief overwrite.** `applyGoals` writes this number into the lifting brief's `daysPerWeek` (L312-316).
  - Coach treats that field as available days (`knowledge.ts` L43).
  - The app's own guide says it must not be overwritten without its own review (`lib/agent/lifting-guide.ts` L15).
  - The brief cannot hold 0 (`lib/lifting-brief.ts` L9).
- Energy uses the stated days, not the recommendation (L117-118).
- **Experience** defaults to "developing". The web form ignores the brief's own experience (`components/goals.tsx` L120), and voice does not require it.

**What the evidence says.**

- **ACSM 2009** recommended 2-3 / 3-4 / 4-5 days a week by training status [144]. The app's caps match the upper ends.
- **ACSM 2026 replaces this** [145]:
  - at least 2 sessions a week for strength;
  - the upper limit is undetermined;
  - frequency has no hypertrophy effect when volume is equal;
  - it criticises the evidence behind the 2009 tiers.
- **Frequency trials.**
  - Gains from more frequent training come mostly through extra volume [146, 147].
  - Strength rises with frequency, with diminishing returns [148].
  - 3 vs 6 sessions a week gave similar gains in trained men [149].
  - Well-trained people showed no clear strength differences between frequencies [153].
- **Minimum dose.** In younger people, one session a week can hold strength and size for up to 32 weeks; older people may need 2 [150]. WHO's 2 or more days is a minimum to encourage [135].
- **Youth.** 2-3 non-consecutive days, with more possible when volume, food and sleep are managed [151].
- **Masters weightlifters** mostly train 3-4 days, up to 5 [152].

**What to change.**

1. **Never write the recommendation into the lifting brief (high).** If the brief is empty and `trainingDays >= 1`, set it to the stated availability through the normal reviewed path.
2. **Remove the floor of 2:** `sessionsPerWeek = min(upper, trainingDays)`, with 0 allowed.
   - 0 days: "No lifting days planned".
   - 1 day: "One heavy session a week can usually hold your strength; older lifters may need 2; WHO and ACSM advise at least 2 for gains and health".
3. **No hard cap for experienced lifters.** Plan all available days. Above the usual range, add a soft note about managing weekly volume, food and sleep.
4. **Under 18:** default to 2-3 non-consecutive days with a note, not a hard cap.
5. **One session count** for energy and the plan (3.2).
6. **Experience:** prefill it from the brief, require it in voice, and show "4 of your 6 available days".

**Safety notes.** The brief overwrite and the floor are product-logic errors against the app's own rules, not science questions. The energy mismatch is an accuracy issue, about 20 kcal in the worst cut example.

---

### 3.20 Supplements (`supplements`)

**What it does.**
- `lib/supplements.ts` L8-20 and L51-75 keep a plain log with a name and a free-text amount. A supplement is "usual" if it was logged on at least 2 of the previous 14 days and not yet today.
- **Core Coach rule** (`knowledge.ts` L136): log as said, never invent an amount, "recording is not endorsement", and refer suspected deficiency, high doses, pregnancy and interactions.
- **Goals paragraph** (L134): "never prescribe ... supplements beyond the well-supported basics (creatine, caffeine, protein powder)".
  - That paragraph belongs to the `goals` skill (`lib/agent/skills.ts` L163-169).
  - It is removed from ordinary turns, together with its bingeing/purging rule.
- **Voice prompt** (L182) says not to prescribe doses. It has no pregnancy, medication, treatment-claim or disordered-eating rule, and never receives age.

**What the evidence says.**

- **General approach** [168, 178]:
  - food first, and assess before supplementing;
  - expert advice is strongly advised;
  - creatine about 20 g a day for 5-7 days, then 3-5 g a day, with a 1-2 kg gain that is mostly water;
  - contaminants include diuretics and stimulants;
  - fat-burner evidence is far from conclusive.
- **Under 18.**
  - ISSN finds creatine acceptable only with supervised training, a balanced diet, education and recommended doses [169].
  - Athletics Australia discourages any supplement under 18 without professional advice [180].
- **Laxatives and diuretics.**
  - Their use counts as purging in the IOC's eating-disorder definitions [1].
  - Laxative use is common in weight-category (combat) athletes [51].
  - Diuretics are prohibited at all times (WADA S5) [179].
- **Anti Doping Danmark.**
  - Strict liability applies; there have been contamination cases in Denmark; use batch-tested products, keep receipts, and declare the last 7 days at a test [175].
  - Members of about 643 cooperating fitness centres can be tested [176].
  - A prescribed prohibited medicine needs a TUE [177].
- **Doses.**
  - EFSA upper levels apply to chronic intake from all sources. Iron has only a safe level, 40 mg [172].
  - Danish public-health advice: vitamin D 5-10 µg October-April for everyone from age 4 [173]; folic acid, vitamin D and iron in pregnancy [174].
  - Alternate-day iron is absorbed better in iron-depleted women [191].

**What to change.**

1. **One rule, in the always-loaded prompt (next to L136) and in voice L182:** "Don't prescribe supplements or doses. If an adult asks, you may describe the general evidence as information: creatine monohydrate 3-5 g a day (a loading week is optional and adds about 1-2 kg of water weight, which matters before a weigh-in); caffeine as in the caffeine rule. Under 18, pregnant or breastfeeding, a medical condition or regular medication: don't suggest performance supplements; refer to a doctor or sports dietitian (and parents for minors). Food first; vitamin D and iron for a diagnosed need or official public-health advice." Remove "creatine, caffeine" from the L134 allowed list.
2. **Laxatives, diuretics, appetite suppressants, fat burners:**
   - If taken to make weight or change shape, or the reason is unclear: ask once, then respond with care. These can harm health, diuretics are prohibited at all times, and contamination is a risk. Suggest a sports doctor or dietitian.
   - A laxative for constipation (common with iron) or a prescribed diuretic is not purging. For a prescribed diuretic, mention the TUE route for tested athletes.
   - Match Danish words too (vanddrivende, fedtforbrænder).
3. **Anti-doping note, scoped:** give it once, when a sports or performance product (pre-workout, fat burner, booster, protein) first appears and the athlete competes or trains in a cooperating gym. Advise batch-tested products and keeping receipts. Offer a last-7-days supplement list for doping-control forms.
4. **Voice parity:** add the pregnancy, medication, treatment-claim and disordered-eating rules, and pass age to voice.
5. **Upper levels (low-medium):** a Coach-only EFSA reference, phrased "above the EFSA long-term upper level; check with a doctor or pharmacist unless it was prescribed". Do not parse daily amounts into alerts.
6. **Usual chips (low):** make them cadence-aware, for example alternate-day iron and training-day products.

**Safety notes.** Because of skill-gating, the purging rule is missing today on ordinary supplement-logging turns. This is high priority and cheap to fix.

---

### 3.21 Caffeine (not tracked) (`caffeine`)

**What it does.**
- There is no caffeine field, limit or timing rule.
- Coffee, tea and energy drinks count fully as fluid (`lib/hydration.ts` L7-19).
- The only mention in code is the skill-gated L134 "well-supported basics" line. In an ordinary "should I take caffeine before snatches?" turn, Coach has no caffeine guidance.
- There are no limits for minors or pregnancy.
- A drink's `at` is the logging time in UTC.

**What the evidence says.**

- **Performance.**
  - Caffeine is a well-supported ergogenic aid [168, 181, 170].
  - 3-6 mg/kg about 60 minutes before, possibly effective from 2 mg/kg. 9 mg/kg or more adds side effects without benefit [170, 168].
  - The benefit plateaus at about 3 mg/kg or 200 mg, so use the lowest effective dose. Under-18s should stay below 2.5 mg/kg a day. Products with a stated dose are preferred over pre-workouts [181].
  - Effects on strength are small (SMD about 0.2) and not significant for lower-body strength [189].
- **EFSA levels of no safety concern** [171], adopted by NNR [182]:
  - adults: 200 mg in one dose (about 3 mg/kg) and 400 mg a day;
  - pregnancy and lactation: 200 mg a day;
  - children and adolescents: 3 mg/kg a day.
- **Denmark.**
  - No energy drinks under 15.
  - At 15-17, at most one 25 cl can a day with no other caffeine, and at most 0.5 L a week of energy or other sweet drinks [184, 183].
  - Pregnancy: at most 200 mg a day, with a slight miscarriage risk from about 100 mg [185].
- **Sleep.**
  - Caffeine cut total sleep by about 45 minutes. Coffee-sized doses should be at least 8.8 h, and pre-workout doses at least 13.2 h, before bed [186].
  - In 23 young men, 100 mg had no effect even 4 hours before bed, while 400 mg affected sleep up to 12 hours later [187].
  - Evidence on evening training is small and fragile [188].
- **Safety.** Pure caffeine powder is dangerous in small amounts [190], and supplements can be contaminated [178].

**What to change.**

1. **A caffeine rule in the always-loaded prompt and voice L182.** Caffeine is optional; Coach may discuss it, not prescribe it. If an adult asks:
   - about 2-3 mg/kg about 60 minutes before training, tried in training first;
   - EFSA's no-concern levels are 200 mg in one dose and 400 mg a day from all sources, coffee and energy drinks included;
   - higher doses add side effects with little extra benefit;
   - never pure powder; prefer a product with a stated dose (batch-tested if drug-tested); avoid multi-ingredient pre-workouts and fat burners.

   Capping a dose at `min(3 mg/kg, 200 mg)` is a conservative policy, not an EFSA finding.
2. **Special groups:**
   - **Under 18:** no performance dosing. Cite EFSA's 3 mg/kg a day only as a ceiling, plus the Danish energy-drink rules above.
   - **Pregnant, trying to conceive or breastfeeding:** at most 200 mg a day, avoid energy drinks, and refer.
   - **Age unknown:** ask before giving any dose.
3. **Sleep as a trade-off:** the lowest dose that works, taken as early as possible; about 100 mg or less within about 6 hours of bed; a personal trial while watching sleep. When sleep is short, ask about afternoon caffeine first.
4. **Policy lines, labelled as policy:** never suggest caffeine to blunt hunger or shed water. Check with a doctor for heart-rhythm problems, high blood pressure, anxiety or regular medication.
5. **Optional:** add a consumed time to `log_drink`. Add a quiet, Coach-only caffeine estimate from drinks (coffee about 0.5 mg/ml, tea 0.2, energy drinks 0.32, cola 0.1) [171, 183], shown as "about" and as a ceiling, never a target.

**Safety notes.** High priority: the current wording permits "prescribing" with no limits, and minors are accepted.

---

### 3.22 How Coach sets targets with the athlete (`coach.goalSetup`)

**What it does.**
- **Text flow.** The goals skill loads on goal words (`lib/agent/skills.ts` L163-197). Coach asks in two short messages (`knowledge.ts` L132; `action-schema.ts` L483-487):
  - age, sex, height, weight;
  - goal weight or focus, date, everyday activity, training days, experience, and body fat only if known.

  It then prepares a reviewed `set_body_goals`.
- **Voice flow.** Coach asks one question at a time, including session length. `set_goals` then saves directly with Undo, and reads back "in two short sentences" (`lib/voice-checkin.ts` L175-176; `lib/voice-actions.ts` L851-871).
  - The returned notes can number 7-8.
  - iPhone receipts collapse the detail to 2 lines (`CoachView.swift` L460-495).
- **Silent resets.** Changing a goal in text resets session length and experience to defaults, because `applyGoals` replaces `profile.body`.
- **Web form defaults.** It preselects "Prefer not to say" and "On my feet some", and has no session-length field (`components/goals.tsx` L105-125).

**What the evidence says.**

- **Pregnancy:** gain, not loss [53, 54, 56], with EFSA's energy increments [7].
- **Breastfeeding.**
  - The app's maintenance leaves out the lactation allowance (about 500 kcal a day in months 0-6 [7]), so "maintain" is already a deficit.
  - Gentle loss from about 4 weeks did not affect infant growth in overweight women [57, 58].
- **Minors:** see 3.4. ACSM discourages weight making in minors [4]. AAP allows slow loss for growing athletes with excess fat, and notes that coaches' weight talk can raise the risk of harmful practices [5].
- **Screening.**
  - IOC CAT2 step 1 uses validated questionnaires or interviews. Primary indicators include secondary amenorrhoea, an eating-disorder score or diagnosis, and low testosterone. Secondary indicators include oligomenorrhoea and a recent bone-stress injury [1].
  - LEAF-Q was validated in female endurance athletes and dancers (78 % sensitivity, 90 % specificity). There is no validated male tool [34].
- **Prescription.** It should rest on current training and nutrition practice, adjusted by trial and error [2]. Requirements can be misjudged by 2 MJ or more [6], and self-reported intake runs about 19 % low [84].
- **Weight classes.** Choose a class that can be reached without undue stress, and judge body composition, not weight alone. The weigh-in is at least 2 hours before competition [4, 50].

**What to change.**

1. **Pregnancy status** in `bodyGoalsRequestSchema` (pregnant / breastfeeding / neither / prefer not to say).
   - Ask female and unspecified users aged 14-55.
   - Enforce it in `planGoals`:
     - pregnant: no deficit and no body-fat goal;
     - breastfeeding: maintenance plus the lactation allowance, and the gentle-loss rule in 3.4;
     - both: a pointer to the midwife or health visitor.
   - Pregnancy status is health data, a special category under GDPR Article 9. Store it only with explicit consent, or ask at goal setup and store only the effect.
2. **Age rule in `planGoals`** (3.4), so text, voice and the web form all follow it. Coach does not ask under-18s for body fat, and the web form hides those fields for them.
3. **Low-energy screen** (pragmatic routing, not a validated test), when the plan loses weight, recomposes, or targets body fat below `veryLean`. Three yes/no questions:
   - (female or unspecified, not on hormonal contraception) "Missed a period, or cycles longer than 35 days, in the last 3 months?"
   - "Any stress fracture in the last 2 years?"
   - "Have you had an eating disorder, or does eating often feel out of your control?"

   Any yes: save maintenance only, suggest a sports doctor or sports dietitian, and never diagnose. Store only the date and a yes/no flag, with consent. Ask again every 3 months while a deficit is active.
4. **Voice:**
   - save directly only for maintain plans with no notes;
   - otherwise read the calories and every safety note and ask "Shall I save that?", or create a pending review card;
   - return safety notes to the model as a separate array, so they survive the two-sentence read-back;
   - expand them on iPhone receipts.
5. **Training load:**
   - ask session length (or weekly lifting hours) in text;
   - prefill from logged sessions, then the brief, then 75 minutes;
   - merge with the saved `profile.body` on any goal change;
   - allow double days.
6. **Form defaults:** do not preselect sex or everyday activity. The activity default alone adds about 230 kcal for a desk worker. The sex default hides the essential-fat warning from women.
7. **Weight class:** ask "Is the goal weight a competition class? When is the weigh-in?". Then follow 3.4 item 8 and 3.17 item 6.
8. **Honest framing:** call it "a starting estimate", rounded to 50 kcal. After a deficit or surplus plan is saved, Coach offers a reviewed check against the weight trend in about 3 weeks.
9. **Inputs:**
   - ask how body fat was measured;
   - convert lb and ft/in;
   - offer the 7-day average weight when at least 3 weigh-ins exist;
   - ask once if the stated weight differs from the latest check-in by more than 10 %.
10. **Coach text contradictions:** see 4.9.

**Safety notes.** Items 1-4 are high priority.

---

### 3.23 Load progression and rest (`training.load`)

**What it does.**
- **The rule** (`js/progression.js`):
  - +2 kg (1 kg a side) when every prescribed set and rep was made, with no miss, no RPE above 8, and recovery not "limited" (L89-110);
  - loads are rounded down (L9-11);
  - history is the last session of the same programme day, however long ago (L66-71).
- **Scope.** Automatic progression runs only for the built-in "Stability & Power Base" programme (`js/public-data.js`). User- and Coach-made programmes repeat the planned weight.
- **RPE.** It is optional on the web (`components/workout-exercise.tsx` L188). The iPhone Train screen has no RPE field (`TrainModel.swift` L73-82), although the API and Coach accept it (`lib/native-api.ts` L526).
- **The "any day" Gym Accessories session** adds 2 kg at every completion. A 20 kg strict press done 3 times a week reaches 42 kg in 4 weeks.
- **Rest timer.** 90 s default on the web; 120 s start on iPhone, with a +30 s button. Programme `restSeconds` is display-only.
- **Minors** get the same increases. `planExercise` receives no age.

**What the evidence says.**

- **Progression rules.**
  - ACSM 2009 (category B): increase load by 2-10 % when 1-2 extra reps are possible on two consecutive sessions. This was stated for training at an RM load, and is backed by one narrative review [144].
  - ACSM 2026 [145]:
    - strength improves with 80 % 1RM or more, 2-3 sets, and 2 or more sessions a week;
    - exact RIR/RPE targets cannot yet be quantified;
    - progression is needed only for continued long-term gains;
    - rest interval did not change strength;
    - data on Olympic lifting are insufficient.

  So the effort gate below is coaching convention, not established science.
- **RPE and autoregulation.**
  - The RPE scale was validated on squats [156].
  - People underpredict reps to failure by about 1 [157].
  - Autoregulated and percentage-based loading give similar 1RM gains [158].
  - Strength gains are similar across a wide range of RIR [165].
- **Weightlifting and youth.** Technique should set the rate of progression in weightlifting [154]. Youth progression should be supervised and technique-based [155].
- **Breaks.** Strength losses are small in breaks under 4 weeks and grow with longer breaks, more so over 65 [161, 162].
- **Long-run gains are slow:** about 9 % over 5 years in world-class weightlifters [163], and about 0.15 kg a day on a powerlifting total [164].
- **Deloads.** A week off slightly reduced lower-body strength gains [166]. Deload definitions are expert opinion [167].
- **Rest.**
  - Trained lifters may need more than 2 minutes' rest to maximise strength [159].
  - For hypertrophy, there is little gain beyond 90 s [160].
  - ACSM 2009 (category B): at least 2-3 minutes for heavy core lifts [144].
- **Warning signs.**
  - A fall in snatch or clean and jerk over time is a REDs warning sign [1].
  - An energy deficit did not significantly reduce strength gains on average [24].
  - Sleep under 6 hours lowers performance, with little effect on morning sessions [130].

**What to change.**

1. **Effort gate** (high, as a product-safety call; the evidence is convention-level):
   - increase only when the last session's top set has RPE 8 or lower, or, with no RPE, after two consecutive fully made sessions at the same load;
   - add a one-tap RPE (7 / 8 / 9 / 10) after the last set on iPhone;
   - say so in the reason text: "No RPE recorded; increase based on two completed sessions";
   - show the progression reason on iPhone (`lib/native-training.ts` L182-183 sends only the target kg).
2. **Light loads (design choice):** below 40 kg, use 1 kg steps when the athlete has 0.5 kg change plates; otherwise require the 2-for-2 rule.
3. **Return from a break (design choice):**
   - after more than 28 days, suggest `floor(0.9 x last load)`;
   - after more than 12 weeks, or at 65+, suggest `floor(0.8 x last load)`, or let the athlete choose;
   - a hold at 15-28 days is optional caution.
4. **Stalls:** after 2 holds in a row caused by misses or RPE above 8 at the same load, propose (not impose) a reset to `floor(0.9 x load)`, labelled as convention.
5. **Minors:** require a "coach checked technique" confirmation, or manual mode, under 18. This needs an age input to `planExercise`, with `profile.age` 0 treated as unknown.
6. **Band ceilings:** an optional "limit: retest or review the block" status when a load passes `PR x top of band`. The docs say the bands are not ceilings (`docs/legacy-app.md` L187-190), so this is a product choice.
7. **Stall during a cut:** a non-diagnostic note when main lifts stall repeatedly while a loss plan is active, and the same signal to Coach. Never change diet targets automatically.
8. **Recovery:** add the "limited" toggle on iPhone. After a night under 6 hours, suggest it with one tap.
9. **Rest (low):**
   - defaults by exercise type: competition lifts, squats and pulls 180 s; other barbell work 120 s; accessories 90 s;
   - use programme `restSeconds` when set;
   - share the preference across web and iPhone.
10. **Small fixes:** say "per side" only for barbell lifts. Note in the docs that custom programmes never progress.

**Safety notes.** Item 1 is high as a product-safety call, because of iPhone sessions and the any-day session. Items 3 and 5 are medium.

---

## 4. Cross-cutting issues

### 4.1 Two calorie numbers, and a weight that never updates

The saved targets (`nutrition.targets`) drive the Food page, iPhone Ledger, Account, Trends and Coach `dailyTargets`. The live plan (`planForState`) drives the web Goals card, Coach `goals.plan` and voice. They drift apart for three reasons:
- a body-fat reading arrives, or ages past 90 days;
- a target date approaches;
- the athlete edits targets manually.

Meanwhile, the plan never takes in check-in weights.
- `bodyweightKg()` prefers the setup weight over check-ins, and that weight also drives the water target and burn estimates.
- The live plan also combines the stale setup weight with the newest body fat to compute lean mass.

Fix:
- **One weight helper**, `currentWeightKg(state, date)`: the mean of check-ins in the last 7 days (later also HealthKit body mass), falling back to the setup weight. Use it for the plan, protein, water, burn and lean mass, and prefill the goals form from it.
- **One shown target**: the saved one, everywhere, including the Goals card. Recompute the live plan only to **propose** an update, as a reviewed change, when **(design choice)**:
  - it differs by at least 100 kcal or 5 %;
  - weight has moved 2-3 %; or
  - a new trusted body-fat reading moves FFM by 2 kg or more.
- **Provenance**: store `source`, `setAt`, `weightKgAtSet` and a target history.

### 4.2 Missing inputs

| Input | Why it matters | Note |
|---|---|---|
| Pregnancy / breastfeeding | No deficit in pregnancy; lactation allowance; carbohydrate 175/210 g; water +; caffeine 200 mg | Special-category health data under GDPR Article 9: explicit consent, or store only the effect |
| Kidney disease or "told to limit protein" | Protein above 1.3 g/kg is to be avoided in CKD at risk [64] | One question at goal setup |
| A single age source | Goals require 14-100, but `profile.age` defaults to 0, voice never gets age, and load progression has no age | One `ageYears(state)` helper; 0 = unknown |
| Body-fat method | Decides whether a reading may drive formulas | Missing on the web goals form and Coach `set_body_goals` |
| Session length | Silently 75 minutes on web and text | Field plus logged durations |
| Weigh-in date and class | Weight-class planning, reminder pauses | Optional structured field |
| Drink time | Needed for any rate or caffeine-timing rule | Optional "consumed at" |

### 4.3 Uncertainty and display

The evidence consistently shows large errors:
- energy requirements can be misjudged by 2 MJ or more [6];
- self-reported intake runs about 19 % low [84];
- device energy is often 20 % or more off [98, 99];
- body-fat readings carry 3.5-5 points of error or more [43, 47];
- day-to-day weight varies by about 0.5 kg [39].

Suggested rounding and wording, sized to those errors (design choices):

| Quantity | Now | Suggested |
|---|---|---|
| Calorie target | 10 kcal | 50 kcal, "about", "starting estimate" |
| Macros | 1 g (web totals 0.1 g) | 5 g; fat and carbohydrate as ranges; protein "at least" |
| Weekly rate | 0.01 kg | 0.05 kg and % of bodyweight; weeks as a range |
| Water | 50 ml; 2 decimals on iPhone | 0.25 L; range; "from drinks" |
| Burned | 1 kcal; watch shown as exact | 10 kcal; "~" on every figure |
| Body fat | 0.1 % | whole % for scale and tape; method and date |
| Weight trend | endpoint slope, 0.01 kg | least squares, 0.1 kg, "about stable" |

Also:
- put "~" on day totals that include estimated meals;
- exclude incomplete days from every average;
- never show an EA number.

### 4.4 Weight-class cutting

76 % of adult weightlifters use chronic and/or acute strategies to make weight [31], and weightlifting weighs in only 2 hours before competing [50]. The app should:
- offer an optional weigh-in (class limit, date);
- plan the chronic cut to reach the class, with loss in the base phase, well away from competition [2];
- when the class cannot be reached at a safe rate, offer a later meet, the next class up, and a sports dietitian;
- never plan acute water or gut-content cuts (Coach already refers these out, `lifting-resources.ts` L94);
- pause water reminders only until the weigh-in time;
- mention that a creatine loading phase adds about 1-2 kg of water [168].

### 4.5 Low energy availability

No single number defines safe intake, and the IOC warns against treating EA as a precise prescription [1]. The defensible approach is several soft layers:
1. Correct maintenance (3.2). This removes most of the shortfall for women.
2. A floor of resting plus training energy, with an absolute minimum (3.3).
3. A deficit cap near 500 kcal a day, unless body fat is high (3.3).
4. Rate and weeks recomputed when a floor binds, and an end point for the plan (3.3).
5. A symptom-led screen before deficits (3.22) and during them: a 12-week check-in, trend alerts above 1 % a week (3.17), and a stall note (3.23).
6. A soft, internal EA check for women only, never shown as a number.

### 4.6 Minors (14-17) and pregnancy

Goal setup accepts age 14, and only prompts refer minors and pregnancy to professionals. What should change, by target:

| Area | Under 18 | Pregnant | Breastfeeding |
|---|---|---|---|
| Energy equation | Henry youth equations | Maintenance + EFSA trimester allowance, if shown at all | Maintenance + about 500 kcal (months 0-6) |
| Deficit | None app-generated (policy); maintain or slow gain | None | None before 4-6 weeks; then at most about 0.5 kg/week at BMI 25+ |
| Body fat | Not asked, not used, no targets [1] | Pause targets and formulas | As adults |
| BMI note | BMI-for-age; real gain is no deficit | Not applicable | As adults |
| Protein | No losing uplift; food first | No app target; refer | No app target; refer |
| Fat | At least 25 % of energy [63] | As adults | As adults |
| Carbohydrate | 130 g floor | 175 g floor | 210 g floor [63] |
| Water | Adults from 14 (EFSA, NNR) | About +250 ml from drinks | About +550 ml from drinks |
| Sleep | 8-10 h | Refer problems | Refer problems |
| Caffeine | No performance dosing; energy-drink rules | At most 200 mg a day | At most 200 mg a day |
| Supplements | No performance supplements; vitamin D public advice is fine | Refer; Danish pregnancy advice [174] | Refer |
| Sessions | Default 2-3 non-consecutive days | Unchanged; refer | Unchanged |
| Load progression | Coach-checked technique | Offer to pause auto-increases if a status exists | Unchanged |
| Display | No "above target" text; hiding numbers optional | No deficit wording | No deficit wording |

Two of these rules are conservative product policies: "no deficit under 18", and "no deficit while breastfeeding in the first weeks". The evidence-based parts are [1, 4, 5, 6, 53, 54]:
- the youth equations;
- EA of 45 for growth;
- no body-composition testing under 18;
- discouraging weight making in minors;
- no weight loss in pregnancy.

### 4.7 Danish and Nordic reference values

Most users are Danish. Where Nordic and Danish values differ from the US figures the app or this report uses:

| Topic | Nordic / Danish value | Note |
|---|---|---|
| Energy | Henry equations, PAL 1.4 / 1.6 / 1.8 [6] | NNR's method gives lower figures than NASEM |
| Protein | 0.83 g/kg, 10-20 % of energy, higher share below 8 MJ [62] | Athlete ranges apply on top |
| Fat | 25-40 % of energy, saturated under 10 % [70] | A 20 % lower bound is below NNR; state it |
| Carbohydrate | 45-60 % of energy; fibre at least 25 g [79, 80] | 130 g is a US RDA, not a Nordic rule |
| Water | 2.0 / 2.5 L total; 1-1.5 L of drinks usually enough [111, 113] | The app's base is athlete-level |
| Sleep | 7-9 h adults, 8-10 h at 14-17 [127] | |
| Activity | At least 30 minutes a day; strength twice a week [138] | Replace the NHS reference |
| Vitamin D | 5-10 µg October-April for everyone from 4 [173] | Public-health baseline |
| Caffeine | Pregnancy 200 mg; energy drinks not under 15; one can a day at 15-17 [184, 185] | |
| Anti-doping | Strict liability; cooperating gyms tested [175, 176] | |
| Labels | EU labels declare kJ and kcal [87] | Consider kJ alongside kcal |

### 4.8 Energy expenditure definitions

The app uses three different figures for the same lifting hour:
- 0.075 kcal/kg/min in the plan;
- 5 MET gross in `strengthBurn`;
- Apple's net active energy.

It also adds gross and net figures together. Use one module:
- lifting at net 4.0 kcal/kg/h (Compendium 02052 minus 1 MET [95], consistent with NNR's PAL increment [6]);
- every app estimate reported net, to match Apple active energy [103];
- the same constant in the plan's training term and the burn display;
- typed values labelled "as entered".

### 4.9 Coach guidance against the computed targets

| Topic | Code | What Coach is told | Fix |
|---|---|---|---|
| Loss rate | 0.4-0.75 %/week | L132: same; L134: 0.5-1 %/week | One range generated from the code constants |
| Gain rate | 0.15-0.35 %/week | L134: 0.25-0.5 % newer, less experienced | Same |
| Protein | 1.8/2.0 g/kg BW; 2.2/2.5 g/kg LBM | L134: 1.6-2.4 and 1.6-2.2; lifting guide L93: 1.4-2.0 | Inject the athlete's own target plus one evidence range |
| Calorie calculation | Exists | `site_help` L49: "No calorie needs calculation ... is available" | Fix L49 |
| Goals vs food | Plan computes a deficit | L144: "do not infer calorie prescriptions from a maintain/lose/gain goal"; lifting guide L94: "never assume weight loss is the goal" | Reconcile wording: Coach explains the app's plan, does not invent its own |
| Floor | Resting energy | "Never ... below resting energy" | Replace with the new floor wording |
| Device energy | Not estimated | L130: "recorded measurements" | Steps and heart rate measured; energy estimated |
| Safety rules | | Purging rule and "basics" clause are in the skill-gated L134 | Move into the core prompt next to L136 |
| Voice | | No eating-disorder, pregnancy, medication or caffeine rules; no age | Parity with text Coach |
| Saved vs live | Two numbers | Coach sees both | "`dailyTargets` is what the athlete sees; `goals.plan` is a recalculation to propose as a reviewed change" |

Two mechanical constraints apply. `knowledge.ts` is covered by a prompt hash test, and `skills.ts` requires each skill paragraph's opening words to stay unique.

---

## 5. Prioritised implementation plan

Each step is meant to be one reviewable PR.
- PRs 1-3 are cheap and remove the highest-risk behaviour.
- PRs 4-7 are the core recalculation.
- The rest are accuracy and display.

**PR 1. Coach prompts (high, cheap).**
- Move the purging rule, a new supplement rule and a new caffeine rule into the core prompt next to L136, and into voice L182.
- Remove "creatine, caffeine" from L134's allowed list.
- Add teen sleep (8-10 h) to L138.
- Reword L134: rates and protein from constants, "at least 7 h", and the "daily steps" framing.
- Replace NHS with WHO and Danish guidance.
- Fix `site_help` L49.
- Change L130 so energy is an estimate.
- Add the water rule (not a minimum; clinician limits override).
- Tell Coach which number the athlete sees.
- Voice parity (pregnancy, medication, disordered eating), and pass age to voice.

Tests:
- `systemPrompt()` without skills contains the purge, supplement and caffeine rules.
- The voice prompt contains the referral rules.
- L134 rate and protein text equals values exported from `body-goals.ts`.
- L49 no longer denies the calculation.
- Update the prompt hash.

**PR 2. Correctness bugs (high).**
- `set_diet_targets` partial merge: schema `.partial()` without defaults; explicit null clears.
- The iPhone review shows the goal label, and before/after values.
- `target <= 0` is treated as none on every surface (web text, iPhone Account and Trends).
- `applyGoals` stops writing `sessionsPerWeek` into the lifting brief.
- Remove the floor of 2 sessions.
- Compute macros from rounded calories.

Tests:
- A calories-only update keeps protein, carbs, fat and the goal label.
- A 0 target renders as "No daily target".
- `applyGoals` leaves the brief unchanged.
- `trainingDays` 0 and 1 give 0 and 1 sessions.

**PR 3. Safety gates in `planGoals` (high).**
- Age under 18: Henry equation, no deficit, no body fat in formulas, no body-fat target.
- Current and goal BMI gates: under 17.5, no loss plan; 17.5-18.5, confirm and cap.
- Implied body-fat check and new wording.
- The new floor (`max(resting + training, 1,200 / 1,500)`), the 500 kcal deficit cap unless body fat is high, and recomputation of rate and weeks.
- Dates under 7 days away, or in the past, give maintenance with a note.

Tests, on a grid over age 14-80, sex, height 150-200 cm, weight 40-200 kg, goal plus or minus 20 %, every activity level, 0-7 days and 30-180 min:
- Calories are at or above the floor.
- No deficit when age is under 18 or BMI is under 17.5.
- Deficit is at most 500 kcal unless body fat is at or above "higher".
- `weeklyChangeKg` equals `(maintenance - calories) x 7 / 7,700` within rounding.

**PR 4. Maintenance and training term (high).**
- Factors 1.4 / 1.55 / 1.75, plus an optional 2.0.
- Maintenance at least 1.4 x resting.
- A shared net 4.0 kcal/kg/h lifting constant.
- Training from `min(trainingDays, sessionsPerWeek)`, with a cap on the training term.
- A session-length field on the web form and in text Coach.
- `applyGoals` merges with the saved `profile.body`.
- No preselected sex or activity.

Tests:
- Maintenance is at least 1.4 x resting.
- A goal-weight change through Coach keeps `sessionMinutes` and `experience`.
- Update the 2,830 kcal case.

**PR 5. Macros (high).**
- Protein obesity path (`W_adj` clamp).
- Fat at 25 % of energy, with no per-kg floor.
- 130 g carbohydrate floor, with the resolution order.
- 5 g rounding.

Tests, on the same grid:
- `|4P + 4C + 9F - kcal| <= 10`.
- Fat between 20 % and 35 % of energy (25-35 % under 18).
- Carbohydrate at least 130 g.
- Protein at most `2.0 x W_adj` when BMI is 30 or more with no body fat.
- Update L34-35 and L116.

**PR 6. Pregnancy, breastfeeding and kidney inputs (high).**
- Schema fields with consent handling.
- `planGoals` behaviour from 3.4 and 3.22.
- Carbohydrate floors of 175/210 g.
- Protein target suppressed.
- Water increments.

Tests:
- Pregnant gives no deficit.
- Breastfeeding gives maintenance plus the allowance, and no deficit before 4-6 weeks.
- Kidney "yes" gives no protein target.

**PR 7. One weight, one target (high).**
- `currentWeightKg` helper and HealthKit body-mass import.
- The live plan uses the current weight.
- The Goals card shows the saved target.
- A proposal flow for updates.
- Reaching the goal, or passing the date, proposes maintenance.
- Target `source`, `setAt`, `weightKgAtSet` and history.
- Trends uses the target in force each day.

Tests:
- A new body-fat reading does not change the displayed target; it only creates a proposal.
- Reaching the goal creates a maintenance proposal.
- Trends rows carry their own targets.

**PR 8. Weight trend (high).**
- Least-squares estimator with minimum data, a trend weight, and "about stable".
- Trend-vs-plan states and amber/red alerts.
- iPhone 7-day comparison.
- Dated weight on iPhone.

Tests:
- Synthetic series with 0.5 kg noise give the right sign at the expected rate.
- Two weigh-ins return "not enough weigh-ins".

**PR 9. Body-fat readings (medium-high).**
- Method capture on web and Coach.
- The trusted-reading rule for formulas.
- Pairing with a weight within 7 days.
- Implausible readings excluded.
- First-of-day Apple import.
- Method and date on iPhone.
- Within-method change.
- Very-lean warning signs.
- Below-minimum confirmation and an Account marker.

Tests:
- A null-method or single scale reading does not switch the equation.
- A 3 % reading for a man is excluded.
- Lean mass uses the paired weight.

**PR 10. Energy expenditure (medium).**
- Device energy marked as estimated, with "~".
- Keytel gating and heart-rate plausibility.
- Apple "other" title mapping, and smoothed cycling bands.
- Net values for cardio and strength together.
- Latest check-in weight, and 10 kcal rounding.
- Strength duration fixes: start at the first set, a saved duration, no re-stamp, merges summed.
- Deferred Apple strength import while a draft is open, with stored start and end.
- One "burned" figure for Today and Coach, with a two-line display.
- Steps cell date label, and clamps.

Tests:
- Walking at 50 % HRmax uses METs, not Keytel.
- An edit two hours later does not change a session's duration.
- A draft-time Apple strength import is not double counted.
- Today and Coach report the same figure.

**PR 11. Water (medium).**
- New base, with 1.5-4.5 L bounds on every weight path.
- Actual training minutes, including cardio and imported strength, capped at 2 L.
- Range display, "from drinks", 0.25 L rounding.
- Reminders from the lower end, and a hide option.
- Account footer fix.
- Alcohol kinds with meal entries.
- Legacy check-in field migration.
- Estimated flags on defaulted volumes.

Tests:
- Targets stay within bounds for weights from 1 to 1,000 kg.
- The training add-on uses real durations.
- Wine is logged with an energy prompt.

**PR 12. Food display (medium).**
- Whole numbers and "about".
- "Under target" on complete days.
- Protein "reached".
- Fat and carbohydrate ranges.
- Below-floor handling.
- The Coach progress visual uses saved targets.
- Partial days excluded from averages, plus a weekly complete-day average.
- A Burned context line.
- Meter and glasses rounding fixes.

Tests:
- A below-floor target never shows "above target".
- Averages ignore today until it is complete.

**PR 13. Coach goal-setup flow (high, after PR 3 and PR 6).**
- Low-energy screen questions.
- Weight-class questions and the weigh-in model.
- Voice confirmation for deficit plans, and a separate safety-notes array.
- Expanded iPhone receipts.
- Unit conversion.
- A 3-week follow-up proposal.

Tests:
- Voice `set_goals` with a deficit returns a confirmation request, not a saved record.
- Any screen "yes" yields maintenance.

**PR 14. Sleep (medium).**
- `sleep-short` opening on web and iPhone.
- Absolute trigger and same-source rule for `sleep-change`.
- Server-side voice flag.
- Averages from at least 5 nights, and rounding.
- One source per night from Apple Health.

Tests:
- A steady 6.0 h athlete gets the opening.
- Mixed-source nights do not fire `sleep-change`.

**PR 15. Load progression (medium; high for the effort gate).**
- 2-for-2 or RPE gate.
- iPhone RPE and recovery controls.
- Reason text on iPhone.
- Break rule.
- Minors confirmation (age passed to `planExercise`).
- Reset proposal.
- Rest defaults by exercise type, and programme `restSeconds`.

Tests:
- The existing simulation (snatch 6 x 1, no RPE) now increases every second session.
- A 12-week gap suggests 90 %.
- An under-18 profile gets no automatic increase without confirmation.

**PR 16. Optional extras (low).**
- One-directional steps hint at goal setup.
- Coach-only caffeine estimate, and drink times.
- Cadence-aware supplement chips.
- kJ alongside kcal.

---

## 6. Sources

Numbered as cited above. At least one reviewer opened each source, and the verifier checked each one, unless noted otherwise.

**Energy, energy availability and weight change**

1. Mountjoy M et al. 2023 International Olympic Committee (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs). British Journal of Sports Medicine 57:1073. BMJ, 2023. https://doi.org/10.1136/bjsports-2023-106994 (copy read: https://www.casem-acmse.org/wp-content/uploads/2024/11/1073.full_.pdf)
2. Thomas DT, Erdman KA, Burke LM. Nutrition and Athletic Performance: joint position of the Academy of Nutrition and Dietetics, Dietitians of Canada and the American College of Sports Medicine. Medicine & Science in Sports & Exercise 48:543. ACSM, 2016. https://doi.org/10.1249/MSS.0000000000000852 (copy read: https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf)
3. Delany LV et al. Dietary recommendations for body mass and composition manipulation in athletes: a scoping review. Sports Medicine 55:2445. Springer, 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12513969/
4. Burke LM et al. ACSM Expert Consensus Statement on Weight Loss in Weight-Category Sports. Current Sports Medicine Reports 20:199. ACSM, 2021. https://researchonline.ljmu.ac.uk/id/eprint/17789/1/ACSM%20Consensus%20Statement%20Weight%20Making.pdf
5. Carl RL, Johnson MD, Martin TJ. Promotion of Healthy Weight-Control Practices in Young Athletes (clinical report). Pediatrics 140:e20171871. American Academy of Pediatrics, 2017. https://doi.org/10.1542/peds.2017-1871 (copy read: https://ncys.org/wp-content/uploads/2022/10/Promotion-of-Healthy-Weight-Control-Practices-in-Youth_AAP.pdf)
6. Cloetens L, Ellegård L. Energy: a scoping review for Nordic Nutrition Recommendations 2023. Food & Nutrition Research 67:10233. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10710868/
7. EFSA. Dietary Reference Values for nutrients: summary report, version 4. European Food Safety Authority, 2017. https://www.efsa.europa.eu/sites/default/files/assets/DRV_Summary_tables_jan_17.pdf
8. EFSA NDA Panel. Scientific Opinion on Dietary Reference Values for energy. EFSA Journal. EFSA, 2013. https://pmc.ncbi.nlm.nih.gov/articles/PMC13159830/
9. National Academies of Sciences, Engineering, and Medicine. Dietary Reference Intakes for Energy. National Academies Press, 2023. Summary: https://www.nationalacademies.org/read/26818/chapter/2 ; Highlights: https://nap.nationalacademies.org/resource/26818/DRIs_for_Energy_Highlights.pdf ; Applications chapter: https://www.nationalacademies.org/read/26818/chapter/9
10. FAO/WHO/UNU. Human energy requirements, chapter 5. Food and Agriculture Organization, 2004. https://www.fao.org/4/y5686e/y5686e07.htm
11. Mifflin MD et al. A new predictive equation for resting energy expenditure in healthy individuals. American Journal of Clinical Nutrition 51:241. 1990. https://europepmc.org/article/MED/2305711
12. Frankenfield D et al. Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review. Journal of the American Dietetic Association 105:775. 2005. https://europepmc.org/article/MED/15883556
13. Cunningham JJ. Body composition as a determinant of energy expenditure: a synthetic review and a proposed general prediction equation. American Journal of Clinical Nutrition 54:963. 1991. https://europepmc.org/article/MED/1957828
14. O'Neill JER, Corish CA, Horner K. Accuracy of resting metabolic rate prediction equations in athletes: a systematic review with meta-analysis. Sports Medicine 53:2373. Springer, 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10687135/
15. ten Haaf T, Weijs PJM. Resting energy expenditure prediction in recreational athletes of 18-35 years. PLoS One 9:e108460. 2014. https://pmc.ncbi.nlm.nih.gov/articles/PMC4183531/
16. Tinsley GM, Graybeal AJ, Moore ML. Resting metabolic rate in muscular physique athletes: validity of existing methods and development of new prediction equations. Applied Physiology, Nutrition, and Metabolism 44:397. 2019. https://doi.org/10.1139/apnm-2018-0412
17. Trexler ET, Smith-Ryan AE, Norton LE. Metabolic adaptation to weight loss: implications for the athlete. Journal of the International Society of Sports Nutrition 11:7. 2014. https://pmc.ncbi.nlm.nih.gov/articles/PMC3943438/
18. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. Journal of the International Society of Sports Nutrition 11:20. 2014. https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/
19. Aragon AA et al. International Society of Sports Nutrition position stand: diets and body composition. Journal of the International Society of Sports Nutrition 14:16. 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/
20. Iraki J et al. Nutrition recommendations for bodybuilders in the off-season: a narrative review. Sports 7:154. MDPI, 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/
21. Helms ER et al. Effect of small and large energy surpluses on strength, muscle, and skinfold thickness in resistance-trained individuals: a parallel groups design. Sports Medicine - Open. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/
22. Roberts BM, Helms ER, Trexler ET, Fitschen PJ. Nutritional recommendations for physique athletes. Journal of Human Kinetics. 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7052702/
23. Ruiz-Castellano C et al. Achieving an optimal fat loss phase in resistance-trained athletes: a narrative review. Nutrients. MDPI, 2021. https://pmc.ncbi.nlm.nih.gov/articles/PMC8471721/
24. Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scandinavian Journal of Medicine & Science in Sports. Wiley, 2022. https://doi.org/10.1111/sms.14075
25. Hall KD. What is the required energy deficit per unit weight loss? International Journal of Obesity 32:573. 2008. https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/
26. Heymsfield SB et al. Energy content of weight loss over time (kinetic features of weight loss). Metabolism. 2012. https://pmc.ncbi.nlm.nih.gov/articles/PMC3810417/
27. Hall KD et al. Quantification of the effect of energy imbalance on bodyweight. The Lancet 378:826. 2011. https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/
28. Hall KD, Chow CC. Why is the 3500 kcal per pound weight loss rule wrong? International Journal of Obesity. 2013. https://pmc.ncbi.nlm.nih.gov/articles/PMC3859816/
29. Slater GJ et al. Is an energy surplus required to maximize skeletal muscle hypertrophy associated with resistance training? Frontiers in Nutrition 6:131. 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6710320/
30. Jensen MD et al. 2013 AHA/ACC/TOS guideline for the management of overweight and obesity in adults. American Heart Association, American College of Cardiology and The Obesity Society, 2013. https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/
31. Cox AM et al. Body mass management practices of Olympic weightlifting athletes. International Journal of Sport Nutrition and Exercise Metabolism 35:67. Human Kinetics, 2025 (online 2024). https://doi.org/10.1123/ijsnem.2024-0064
32. Areta JL, Taylor HL, Koehler K. Low energy availability: history, definition and evidence of its endocrine, metabolic and physiological effects in prospective studies in females and males. European Journal of Applied Physiology. Springer, 2021 (online 2020). https://pmc.ncbi.nlm.nih.gov/articles/PMC7815551/
33. Burke LM et al. Pitfalls of conducting and interpreting estimates of energy availability in free-living athletes. International Journal of Sport Nutrition and Exercise Metabolism. 2018. https://europepmc.org/article/MED/30029584
34. Melin A et al. The LEAF questionnaire: a screening tool for the identification of female athletes at risk for the female athlete triad. British Journal of Sports Medicine. 2014 (abstract). https://europepmc.org/article/MED/24563388

**Body weight, body composition and special groups**

35. World Health Organization. Global Health Observatory indicators: prevalence of underweight among adults; prevalence of thinness among adolescents. WHO. https://www.who.int/data/gho/indicator-metadata-registry/imr-details/4804 ; https://www.who.int/data/gho/indicator-metadata-registry/imr-details/prevalence-of-thinness-among-adolescents
36. Cole TJ et al. Body mass index cut offs to define thinness in children and adolescents: international survey. BMJ. 2007. https://pmc.ncbi.nlm.nih.gov/articles/PMC1934447/
37. Williams NI et al. 2025 update to the Female Athlete Triad Coalition consensus statement, part 2. Sports Medicine. 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12982345/
38. Jensen GL, Cederholm T et al. GLIM consensus approach to the diagnosis of malnutrition: a 5-year update. Journal of Parenteral and Enteral Nutrition. 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12053077/
39. Cheuvront SN et al. Daily body mass variability and stability in active men undergoing exercise-heat stress. International Journal of Sport Nutrition and Exercise Metabolism. 2004. https://europepmc.org/article/MED/15673099
40. Turicchi J et al. Weekly, seasonal and holiday body weight fluctuation patterns among individuals engaged in a European multi-centre behavioural weight loss maintenance intervention. PLOS ONE. 2020. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232152
41. Garthe I et al. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. International Journal of Sport Nutrition and Exercise Metabolism. 2011 (abstract). https://europepmc.org/article/MED/21558571
42. Thomas DM et al. Can a weight loss of one pound a week be achieved with a 3500-kcal deficit? International Journal of Obesity. 2013. https://europepmc.org/article/MED/23628852
43. Turocy PS et al. National Athletic Trainers' Association position statement: safe weight loss and maintenance practices in sport and exercise. Journal of Athletic Training 46:322. NATA, 2011. https://pmc.ncbi.nlm.nih.gov/articles/PMC3419563/
44. Hulmi JJ et al. The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors. Frontiers in Physiology. 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5222856/
45. Rossow LM et al. Natural bodybuilding competition preparation and recovery: a 12-month case study. International Journal of Sports Physiology and Performance. 2013 (abstract). https://pubmed.ncbi.nlm.nih.gov/23412685/
46. Frija-Masson J et al. Accuracy of smart scales on weight and body composition: observational study. JMIR mHealth and uHealth. 2021. https://pmc.ncbi.nlm.nih.gov/articles/PMC8122302/
47. Oliver et al. Validity of bioelectrical impedance analysis compared to a four-compartment model: systematic review. Journal of Functional Morphology and Kinesiology 11:65. MDPI, 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC12922097/
48. Dixon CB, Masteller B, Andreacci JL. The effect of a meal on measures of impedance and percent body fat estimated using contact-electrode bioelectrical impedance technology. European Journal of Clinical Nutrition. 2013 (abstract). https://pubmed.ncbi.nlm.nih.gov/23820339/
49. Hall KD. Body fat and fat-free mass inter-relationships: Forbes's theory revisited. British Journal of Nutrition. 2007 (abstract). https://pubmed.ncbi.nlm.nih.gov/17367567/
50. Nordic Weightlifting Federation. Technical Competition Rules and Regulations (weigh-in timing). NWF. https://nordicweightlifting.com/nwf-technical-competition-rules-and-regulations-tcrr/
51. Reale R. Acute weight management in combat sports: pre weigh-in weight loss, post weigh-in recovery and competition nutrition strategies. Sports Science Exchange #183. Gatorade Sports Science Institute, 2018. https://www.gssiweb.org/docs/default-source/sse-docs/reale_sse_183.pdf?sfvrsn=2
52. Ricci AA et al. International Society of Sports Nutrition position stand: nutrition and weight cut strategies for mixed martial arts and other combat sports. Journal of the International Society of Sports Nutrition. 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC11894756/
53. Institute of Medicine (Rasmussen KM, Yaktine AL, eds). Weight Gain During Pregnancy: Reexamining the Guidelines. National Academies Press, 2009. https://www.nationalacademies.org/read/12584/chapter/2
54. sundhed.dk Patienthåndbogen. Graviditetsuge 27 (weight gain in pregnancy, citing Sundhedsstyrelsen). 2025. https://www.sundhed.dk/borger/patienthaandbogen/graviditet/graviditetskalender/mor/graviditetsuge-27-mor/
55. Søndersted et al. Risici og behandlingsmuligheder hos kvinder med overvægt og graviditetsønske. Ugeskrift for Læger. 2025. https://ugeskriftet.dk/videnskab/risici-og-behandlingsmuligheder-kvinder-med-overvaegt-og-graviditetsoenske
56. NHS. Weight gain in pregnancy. National Health Service, reviewed 2022. https://www.nhs.uk/pregnancy/related-conditions/common-symptoms/weight-gain/
57. Lovelady CA et al. The effect of weight loss in overweight, lactating women on the growth of their infants. New England Journal of Medicine. 2000 (abstract). https://europepmc.org/article/MED/10675424
58. Lovelady C. Balancing exercise and food intake with lactation to promote post-partum weight loss. Proceedings of the Nutrition Society. Cambridge University Press, 2011. https://www.cambridge.org/core/journals/proceedings-of-the-nutrition-society/article/balancing-exercise-and-food-intake-with-lactation-to-promote-postpartum-weight-loss/FA33CD963914F2692C16A7086465CFE2

**Protein, fat and carbohydrate**

59. Jäger R et al. International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition 14:20. 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/
60. Morton RW et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. British Journal of Sports Medicine 52:376. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/
61. Schoenfeld BJ, Aragon AA. How much protein can the body use in a single meal for muscle-building? Journal of the International Society of Sports Nutrition 15:10. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5828430/
62. Geirsdóttir ÓG, Pajari AM. Protein: a scoping review for Nordic Nutrition Recommendations 2023. Food & Nutrition Research. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10770649/ (NNR protein chapter: https://pub.norden.org/nord2023-003/files/691f2f1ccbe12_protein.pdf)
63. Institute of Medicine / National Academies. Dietary Reference Intakes: macronutrients summary table. National Academies, 2002/2005. https://www.nationalacademies.org/cdn/materials/9fb9fae1-63a0-4048-88ad-3f972639149a
64. KDIGO. 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease, executive summary. Kidney Disease: Improving Global Outcomes, 2024. https://kdigo.org/wp-content/uploads/2017/02/KDIGO-2024-CKD-Guideline-Executive-Summary.pdf
65. Devries MC et al. Changes in kidney function do not differ between healthy adults consuming higher- compared with lower- or normal-protein diets: a systematic review and meta-analysis. Journal of Nutrition. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC6236074/
66. Joslin Diabetes Center. Clinical Nutrition Guideline for Overweight and Obese Adults with Type 2 Diabetes, Prediabetes or Those at High Risk. Joslin, 2016 (updated 2018). https://joslin.org/-/media/files/joslin/joslin-clinical-nutrition-guideline-for-overweight-and-obese-adults.pdf
67. Leidy HJ et al. The role of protein in weight loss and maintenance. American Journal of Clinical Nutrition. 2015 (abstract). https://doi.org/10.3945/ajcn.114.084038
68. Ota E et al. Antenatal dietary education and supplementation to increase energy and protein intake. Cochrane Database of Systematic Reviews. 2015 (abstract). https://doi.org/10.1002/14651858.CD000032.pub3
69. Boisseau N et al. Protein requirements in male adolescent soccer players. European Journal of Applied Physiology. 2007 (abstract). https://doi.org/10.1007/s00421-007-0400-4
70. Nordic Council of Ministers. Nordic Nutrition Recommendations 2023: fat and fatty acids. 2023. https://pub.norden.org/nord2023-003/files/68f20d379db17_fat-and-fatty-acids.pdf
71. EFSA NDA Panel. Scientific Opinion on Dietary Reference Values for fats. EFSA Journal 8(3):1461. EFSA, 2010. https://doi.org/10.2903/j.efsa.2010.1461
72. World Health Organization. WHO updates guidelines on fats and carbohydrates (news release). WHO, 2023. https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates
73. Whittaker J, Wu K. Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies. Journal of Steroid Biochemistry and Molecular Biology 210:105878. 2021. https://doi.org/10.1016/j.jsbmb.2021.105878
74. Kerksick CM et al. ISSN exercise and sports nutrition review update: research and recommendations. Journal of the International Society of Sports Nutrition 15:38. 2018. https://doi.org/10.1186/s12970-018-0242-y
75. Slater G, Phillips SM. Nutrition guidelines for strength sports: sprinting, weightlifting, throwing events, and bodybuilding. Journal of Sports Sciences 29 (S1):S67. Taylor & Francis, 2011. https://doi.org/10.1080/02640414.2011.574722
76. Henselmans M, Bjørnsen T, Hedderman R, Vårvik FT. The effect of carbohydrate intake on strength and resistance training performance: a systematic review. Nutrients 14:856. MDPI, 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC8878406/
77. King A, Helms E, Zinn C, Jukic I. The ergogenic effects of acute carbohydrate feeding on resistance exercise performance: a systematic review and meta-analysis. Sports Medicine 52:2691. 2022 (abstract). https://doi.org/10.1007/s40279-022-01716-w
78. Henselmans M, Vårvik FT, Izquierdo M. Carbohydrate intake and muscle hypertrophy: meta-analysis. Sports Medicine 56:691. 2026 (abstract). https://doi.org/10.1007/s40279-025-02341-z
79. Nordic Nutrition Recommendations 2023: carbohydrate scoping review. Food & Nutrition Research. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10710865/
80. Nordic Nutrition Recommendations 2023: dietary fibre scoping review. Food & Nutrition Research. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10619389/
81. EFSA NDA Panel. Scientific Opinion on Dietary Reference Values for carbohydrates and dietary fibre. EFSA Journal. EFSA, 2010 (abstract). https://doi.org/10.2903/j.efsa.2010.1462
82. Fensham NC et al. Short-term carbohydrate restriction impairs bone formation at rest and during prolonged exercise to a greater degree than low energy availability. Journal of Bone and Mineral Research 37:1915. 2022. https://doi.org/10.1002/jbmr.4658
83. American Diabetes Association. Standards of Care in Diabetes 2025, Section 5: Facilitating positive health behaviors and well-being. Diabetes Care. ADA, 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC11635047/

**Logging accuracy, labelling and display**

84. Capling L et al. Validity of dietary assessment in athletes: a systematic review. Nutrients 9:1313. MDPI, 2017. https://doi.org/10.3390/nu9121313
85. Fridolfsson J et al. Large language model nutrient estimation from food images. Current Developments in Nutrition. 2025. https://doi.org/10.1016/j.cdnut.2025.107556
86. European Commission. Guidance document on tolerances for nutrient values declared on a label. EC, 2012. https://food.ec.europa.eu/system/files/2016-10/labelling_nutrition-vitamins_minerals-guidance_tolerances_1212_en.pdf
87. European Union. Regulation (EU) No 1169/2011 on the provision of food information to consumers, Annex XIV (conversion factors). EUR-Lex, 2011. https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011R1169
88. Anderberg et al. Diet and fitness app use and disordered eating: a systematic review. Body Image. 2025 (abstract). https://europepmc.org/article/MED/39671845
89. Golden NH et al. Preventing obesity and eating disorders in adolescents (clinical report). Pediatrics. American Academy of Pediatrics, 2016 (abstract). https://doi.org/10.1542/peds.2016-1649
90. Moody et al. Fitness and diet tracking and disordered eating: a systematic review. European Eating Disorders Review. 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/

**Energy expenditure and wearables**

91. Keytel LR et al. Prediction of energy expenditure from heart rate monitoring during submaximal exercise. Journal of Sports Sciences 23:289. 2005 (abstract). https://europepmc.org/article/MED/15966347
92. Collins MA, Cureton KJ, Hill DW, Ray CA. Relationship of heart rate to oxygen uptake during weight lifting exercise. Medicine & Science in Sports & Exercise. 1991 (abstract). https://europepmc.org/article/MED/2072844
93. Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. Journal of the American College of Cardiology. 2001 (abstract). https://europepmc.org/article/MED/11153730
94. MRC Epidemiology Unit. DAPA Measurement Toolkit: heart rate monitors. University of Cambridge. https://www.measurement-toolkit.org/physical-activity/objective-methods/heart-rate-monitors
95. Herrmann SD et al. 2024 Adult Compendium of Physical Activities. Journal of Sport and Health Science. 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/ ; conditioning exercise codes: https://pacompendium.com/conditioning-exercise/
96. Willis EA et al. Older Adult Compendium of Physical Activities. Journal of Sport and Health Science. 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC10818108/
97. Butte NF et al. A Youth Compendium of Physical Activities. Medicine & Science in Sports & Exercise. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5768467/
98. Choe J, Kang M. Validity of Apple Watch measurements: a meta-analysis. Physiological Measurement 46(4). IOP, 2025 (abstract). https://europepmc.org/article/MED/40199339
99. Fuller D et al. Reliability and validity of commercially available wearable devices for measuring steps, energy expenditure, and heart rate: systematic review. JMIR mHealth and uHealth. 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7509623/
100. O'Driscoll R et al. How well do activity monitors estimate energy expenditure? A systematic review and meta-analysis. British Journal of Sports Medicine. 2020 (online 2018). https://doi.org/10.1136/bjsports-2018-099643
101. Shcherbina A et al. Accuracy in wrist-worn, sensor-based measurements of heart rate and energy expenditure in a diverse cohort. Journal of Personalized Medicine. 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5491979/
102. Lee et al. Smartwatch energy expenditure during endurance and resistance exercise. Sensors 26:2526. MDPI, 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13120158/
103. Apple. HealthKit documentation: HKQuantityTypeIdentifier.activeEnergyBurned. Apple Developer. https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned
104. Apple. iPhone User Guide: see your activity summary in Fitness on iPhone. Apple Support. https://support.apple.com/guide/iphone/see-your-activity-summary-iph4c34a8a95/ios
105. Mitchell et al. Methods to assess energy expenditure of resistance exercise: a systematic scoping review. Sports Medicine. 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC11393209/
106. Rustaden AM et al. Energy expenditure of heavy-load resistance exercise compared with BodyPump. Frontiers in Physiology. 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7298122/
107. Reddy RK et al. Accuracy of wrist-worn activity monitors during common daily physical activities and types of structured exercise. JMIR mHealth and uHealth. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC6305876/
108. Lytle JR et al. Predicting energy expenditure of an acute resistance exercise bout in men and women. Medicine & Science in Sports & Exercise. 2019 (abstract). https://pubmed.ncbi.nlm.nih.gov/30768553/

**Water and fluids**

109. Institute of Medicine. Dietary Reference Intakes for Water, Potassium, Sodium, Chloride, and Sulfate. National Academies Press, 2005. Summary: https://www.nationalacademies.org/read/10925/chapter/2 ; Water chapter: https://www.nationalacademies.org/read/10925/chapter/6
110. EFSA NDA Panel. Scientific Opinion on Dietary Reference Values for water. EFSA Journal. EFSA, 2010 (abstract). https://doi.org/10.2903/j.efsa.2010.1459
111. Nordic Council of Ministers. Nordic Nutrition Recommendations 2023: fluid and water balance. 2023. https://pub.norden.org/nord2023-003/fluid-and-water-balance.html
112. Iversen PO, Fogelholm M. Fluid and water balance: a scoping review for the Nordic Nutrition Recommendations 2023. Food & Nutrition Research. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10710856/
113. Fødevarestyrelsen. Sluk tørsten i vand (official Danish dietary guidelines). Danish Veterinary and Food Administration. https://foedevarestyrelsen.dk/kost-og-foedevarer/alt-om-mad/de-officielle-kostraad/kostraad-til-dig/om-de-officielle-kostraad/sluk-toersten-i-vand
114. Yamada Y et al. Variation in human water turnover associated with environmental and lifestyle factors. Science 378:909. AAAS, 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC9764345/
115. McDermott BP et al. National Athletic Trainers' Association position statement: fluid replacement for the physically active. Journal of Athletic Training 52:877. NATA, 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5634236/
116. NICE. Intravenous fluid therapy in adults in hospital (CG174). National Institute for Health and Care Excellence, 2013 (updated 2017). https://www.nice.org.uk/guidance/cg174/chapter/Recommendations
117. Maughan RJ et al. A randomized trial to assess the potential of different beverages to affect hydration status: development of a beverage hydration index. American Journal of Clinical Nutrition. 2016 (abstract). https://www.stir.ac.uk/research/hub/publication/577765
118. Killer SC, Blannin AK, Jeukendrup AE. No evidence of dehydration with moderate daily coffee intake: a counterbalanced cross-over study in a free-living population. PLoS One. 2014. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0084154
119. Zhang Y et al. Caffeine and diuresis during rest and exercise: a meta-analysis. Journal of Science and Medicine in Sport. 2015 (abstract). https://nsuworks.nova.edu/hpd_hhp_facarticles/32/
120. Polhuis KCMM et al. The diuretic action of weak and strong alcoholic beverages in elderly men: a randomized diet-controlled crossover trial. Nutrients. MDPI, 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5537780/
121. Hew-Butler T et al. Statement of the Third International Exercise-Associated Hyponatremia Consensus Development Conference. Clinical Journal of Sport Medicine. 2015. https://emergencymedicinecases.com/wp-content/uploads/filebase/pdf/Statement_of_the_Third_International.pdf
122. Savoie FA et al. Effect of hypohydration on muscle endurance, strength, anaerobic power and capacity and vertical jumping ability: a meta-analysis. Sports Medicine. 2015 (abstract). https://pubmed.ncbi.nlm.nih.gov/26178327/

**Sleep**

123. Centers for Disease Control and Prevention. About Sleep. CDC, updated 2024. https://www.cdc.gov/sleep/about/index.html
124. Watson NF et al. Recommended amount of sleep for a healthy adult: a joint consensus statement of the AASM and SRS. Journal of Clinical Sleep Medicine 11:591. 2015. https://www.aasm.org/resources/pdf/adultsleepdurationconsensus.pdf
125. Paruthi S et al. Recommended amount of sleep for pediatric populations: AASM consensus statement. Journal of Clinical Sleep Medicine 12:785. 2016. https://aasm.org/resources/pdf/pediatricsleepdurationconsensus.pdf
126. National Sleep Foundation. National Sleep Foundation reaffirms landmark sleep duration recommendations (press release). NSF, June 2026. https://www.prnewswire.com/news-releases/national-sleep-foundation-reaffirms-landmark-sleep-duration-recommendations-302796838.html
127. DR Nyheder. For første gang anbefaler Sundhedsstyrelsen, hvor meget voksne bør sove (reporting the Danish Health Authority's sleep recommendation). DR, April 2024. https://www.dr.dk/nyheder/seneste/foerste-gang-anbefaler-sundhedsstyrelsen-hvor-meget-voksne-boer-sove
128. Walsh NP et al. Sleep and the athlete: narrative review and 2021 expert consensus recommendations. British Journal of Sports Medicine 55:356. 2021. https://doi.org/10.1136/bjsports-2020-102025
129. Lastella M et al. Sleep/wake behaviours of elite athletes from individual and team sports. European Journal of Sport Science. 2015 (abstract). https://europepmc.org/article/MED/24993935
130. Craven J et al. Effects of acute sleep loss on physical performance: a systematic and meta-analytical review. Sports Medicine. 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC9584849/
131. Nedeltcheva AV et al. Insufficient sleep undermines dietary efforts to reduce adiposity. Annals of Internal Medicine 153:435. 2010. https://pmc.ncbi.nlm.nih.gov/articles/PMC2951287/
132. Milewski MD et al. Chronic lack of sleep is associated with increased sports injuries in adolescent athletes. Journal of Pediatric Orthopaedics. 2014 (abstract). https://europepmc.org/article/MED/25028798
133. Lauderdale DS et al. Self-reported and measured sleep duration: how similar are they? Epidemiology. 2008 (abstract). https://europepmc.org/article/MED/18854708
134. Aili K et al. Reliability of actigraphy and subjective sleep measurements in adults: the design of sleep assessments. Journal of Clinical Sleep Medicine. 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5181612/

**Physical activity and steps**

135. Bull FC et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. British Journal of Sports Medicine. WHO, 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/
136. NHS. Physical activity guidelines for adults aged 19 to 64. National Health Service, reviewed 2024. https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-for-adults-aged-19-to-64/
137. Borodulin K, Anderssen S. Physical activity: a scoping review for Nordic Nutrition Recommendations 2023. Food & Nutrition Research. 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10335097/
138. Statens Institut for Folkesundhed (SDU). Karakteristik af danskere, der ikke efterlever WHO's anbefalinger for fysisk aktivitet (note citing the Danish Health Authority's recommendations). SIF, 2026. The reviewer read a PDF copy but did not record its URL; sst.dk could not be opened (HTTP 429).
139. Paluch AE et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. Lancet Public Health. 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC9289978/
140. Ding D et al. Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis. Lancet Public Health. 2025 (abstract). https://doi.org/10.1016/S2468-2667(25)00164-1
141. Tudor-Locke C et al. How many steps/day are enough? For adults. International Journal of Behavioral Nutrition and Physical Activity. 2011. https://pmc.ncbi.nlm.nih.gov/articles/PMC3197470/
142. Lambe et al. Accuracy of consumer wearables: a living systematic review. npj Digital Medicine. 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC12823594/
143. Richardson CR et al. A meta-analysis of pedometer-based walking interventions and weight loss. Annals of Family Medicine. 2008. https://pmc.ncbi.nlm.nih.gov/articles/PMC2203404/

**Resistance training**

144. Ratamess NA et al. ACSM position stand: progression models in resistance training for healthy adults. Medicine & Science in Sports & Exercise 41:687. ACSM, 2009. https://doi.org/10.1249/MSS.0b013e3181915670
145. Currier BS et al. ACSM position stand: resistance training prescription for muscle function, hypertrophy and physical performance in healthy adults. Medicine & Science in Sports & Exercise 58:851. ACSM, 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/
146. Grgic J et al. Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis. Sports Medicine 48:1207. 2018 (abstract). https://pubmed.ncbi.nlm.nih.gov/29470825/
147. Schoenfeld BJ, Grgic J, Krieger J. How many times per week should a muscle be trained to maximize muscle hypertrophy? Journal of Sports Sciences. 2019 (abstract). https://pubmed.ncbi.nlm.nih.gov/30558493/
148. Pelland JC et al. Resistance training frequency, strength and hypertrophy: meta-regression. Sports Medicine 56:481. 2026 (abstract). https://pubmed.ncbi.nlm.nih.gov/41343037/
149. Colquhoun RJ et al. Training volume, not frequency, indicative of maximal strength adaptations to resistance training. Journal of Strength and Conditioning Research. 2018 (abstract). https://pubmed.ncbi.nlm.nih.gov/29324578/
150. Spiering BA et al. Maintaining physical performance: the minimal dose of exercise needed to preserve endurance and strength over time. Journal of Strength and Conditioning Research. 2021 (abstract). https://pubmed.ncbi.nlm.nih.gov/33629972/
151. Faigenbaum AD et al. Youth resistance training: updated position statement paper from the National Strength and Conditioning Association. Journal of Strength and Conditioning Research 23 (Suppl 5):S60. NSCA, 2009. https://doi.org/10.1519/JSC.0b013e31819df407
152. Huebner M et al. Training and performance characteristics of Masters weightlifters. PLoS One. 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7717526/
153. Cuthbert M et al. The effect of training frequency on strength in well-trained populations. Sports Medicine 51:1967. 2021. https://pmc.ncbi.nlm.nih.gov/articles/PMC8363540/
154. Comfort P et al. National Strength and Conditioning Association position statement on weightlifting for sports performance. NSCA, 2023. https://www.nsca.com/contentassets/d8cfbfa7955544a78832822bbada99b7/nsca-position-statement-on-weightlifting.pdf
155. Lloyd RS et al. Position statement on youth resistance training: the 2014 international consensus. British Journal of Sports Medicine. 2014. https://pubmed.ncbi.nlm.nih.gov/24055781/
156. Zourdos MC et al. Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. Journal of Strength and Conditioning Research. 2016 (abstract). https://pubmed.ncbi.nlm.nih.gov/26049792/
157. Halperin I et al. Accuracy in predicting repetitions to task failure in resistance exercise: a scoping review and exploratory meta-analysis. Sports Medicine. 2022 (abstract). https://pubmed.ncbi.nlm.nih.gov/34542869/
158. Hickmott LM et al. The effect of load and volume autoregulation on muscular strength and hypertrophy: a systematic review and meta-analysis. Sports Medicine - Open. 2022 (abstract). https://pubmed.ncbi.nlm.nih.gov/35038063/
159. Grgic J et al. Effects of rest interval duration in resistance training on measures of muscular strength: a systematic review. Sports Medicine. 2018 (abstract). https://pubmed.ncbi.nlm.nih.gov/28933024/
160. Singer A et al. Give it a rest: a systematic review with Bayesian meta-analysis on the effect of inter-set rest interval duration on muscle hypertrophy. Frontiers in Sports and Active Living. 2024 (abstract). https://pubmed.ncbi.nlm.nih.gov/39205815/
161. Mujika I, Padilla S. Detraining: loss of training-induced physiological and performance adaptations. Sports Medicine. 2000 (abstract). https://pubmed.ncbi.nlm.nih.gov/10966148/
162. Bosquet L et al. Effect of training cessation on muscular performance: a meta-analysis. Scandinavian Journal of Medicine & Science in Sports. 2013 (abstract). https://pubmed.ncbi.nlm.nih.gov/23347054/
163. Solberg PA et al. Peak age and performance progression in world-class weightlifting and powerlifting athletes. International Journal of Sports Physiology and Performance. 2019 (abstract). https://pubmed.ncbi.nlm.nih.gov/30958059/
164. Latella C et al. Long-term strength adaptation: a 15-year analysis of powerlifting athletes. Journal of Strength and Conditioning Research. 2020 (abstract). https://pubmed.ncbi.nlm.nih.gov/32865942/
165. Robinson ZP et al. Exploring the dose-response relationship between estimated resistance training proximity to failure, strength gain, and muscle hypertrophy: a series of meta-regressions. Sports Medicine. 2024 (abstract). https://pubmed.ncbi.nlm.nih.gov/38970765/
166. Coleman M et al. Gaining more from doing less? The effects of a one-week deload period during supervised resistance training. PeerJ. 2024 (abstract). https://pubmed.ncbi.nlm.nih.gov/38274324/
167. Bell L et al. Integrating deloading into strength and physique sports training programmes: an international Delphi consensus approach. Sports Medicine - Open. 2023 (abstract). https://pubmed.ncbi.nlm.nih.gov/37730925/

**Supplements, caffeine and anti-doping**

168. Maughan RJ et al. IOC consensus statement: dietary supplements and the high-performance athlete. British Journal of Sports Medicine. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5867441/
169. Kreider RB et al. International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation. Journal of the International Society of Sports Nutrition. 2017. https://pmc.ncbi.nlm.nih.gov/articles/PMC5469049/
170. Guest NS et al. International Society of Sports Nutrition position stand: caffeine and exercise performance. Journal of the International Society of Sports Nutrition. 2021. https://pmc.ncbi.nlm.nih.gov/articles/PMC7777221/
171. EFSA. Caffeine (topic page summarising the 2015 scientific opinion on the safety of caffeine). EFSA. https://www.efsa.europa.eu/en/topics/topic/caffeine
172. EFSA. Overview on Tolerable Upper Intake Levels, version 11. EFSA, August 2025. https://www.efsa.europa.eu/sites/default/files/2024-05/ul-summary-report.pdf
173. Fødevarestyrelsen. D-vitamin (official Danish advice). Danish Veterinary and Food Administration. https://foedevarestyrelsen.dk/kost-og-foedevarer/alt-om-mad/de-officielle-kostraad/vil-du-vide-mere/hvad-er-naeringsstoffer/d-vitamin
174. sundhed.dk Patienthåndbogen. Graviditet og kosttilskud. Updated April 2024. https://www.sundhed.dk/borger/patienthaandbogen/graviditet/graviditet-foedsel-barsel/levevis-i-graviditeten/graviditet-og-kosttilskud/
175. Anti Doping Danmark. Kosttilskud. ADD. https://www.antidoping.dk/doping/kosttilskud
176. Anti Doping Danmark. Samarbejde med fitnesscentre. ADD. https://www.antidoping.dk/doping/samarbejde-med-fitnesscentre/
177. Anti Doping Danmark. Medicinsk dispensation (TUE). ADD. https://www.antidoping.dk/doping/medicinsk-dispensation-tue/
178. Team Danmark. Kosttilskud (and Anvendelse; Anskaffelse af kosttilskud). Team Danmark. https://www.teamdanmark.dk/til-atleter/sportsernaering/kosttilskud
179. World Anti-Doping Agency. Prohibited List 2026 (bilingual edition published by JADA). WADA, 2026. https://www.playtruejapan.org/entry_img/2026_prohibited_List_jpn.pdf
180. Athletics Australia. Supplements in Sport policy (based on the AIS Sports Supplement Framework). Athletics Australia, reviewed 2023. https://www.athletics.com.au/wp-content/uploads/2025/05/POLICY-AA-Supplements-in-Sport.pdf
181. Australian Institute of Sport. Sports Supplement Framework, Group A, and caffeine practitioner fact sheet. AIS. https://www.ausport.gov.au/ais/nutrition/supplements/group_a
182. Sonestedt E, Lukic M. Beverages: a scoping review for Nordic Nutrition Recommendations 2023. Food & Nutrition Research. 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC10989231/
183. Matthiessen J et al. Koffein- og energidrikkeindtag i Danmark med fokus på børn og unge. DTU Fødevareinstituttet, April 2026. https://www.food.dtu.dk/-/media/institutter/foedevareinstituttet/publikationer/pub-2026/koffein-og-energidrikkeindtag-i-danmark-med-fokus-paa-boern-og-unge_report.pdf
184. Fødevarestyrelsen. Derfor er energidrikke ikke for børn (news, and the energy drinks page). Danish Veterinary and Food Administration, February 2024. https://foedevarestyrelsen.dk/nyheder/faglige-nyheder/2024/feb/aok-derfor-er-energidrikke-ikke-for-boern
185. sundhed.dk Patienthåndbogen. Kaffe og graviditet. Updated August 2026. https://www.sundhed.dk/borger/patienthaandbogen/graviditet/graviditet-foedsel-barsel/levevis-i-graviditeten/kaffe-og-graviditet/
186. Gardiner C et al. The effect of caffeine on subsequent sleep: a systematic review and meta-analysis. Sleep Medicine Reviews. 2023 (abstract). https://doi.org/10.1016/j.smrv.2023.101764
187. Gardiner C et al. Dose and timing effects of caffeine on subsequent sleep: a randomised clinical crossover trial. Sleep 48(4). 2025 (online 2024). https://pmc.ncbi.nlm.nih.gov/articles/PMC11985402/
188. Kocak et al. Caffeine before evening exercise and sleep: a meta-analysis. Sports (Basel). MDPI, 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12473705/
189. Grgic J et al. Effects of caffeine intake on muscle strength and power: a systematic review and meta-analysis. Journal of the International Society of Sports Nutrition. 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5839013/
190. US Food and Drug Administration. Spilling the beans: how much caffeine is too much? FDA, updated August 2024. https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
191. Stoffel NU et al. Iron absorption from oral iron supplements given on consecutive versus alternate days and as single morning doses versus twice-daily split dosing in iron-depleted women. Lancet Haematology. 2017 (abstract). https://doi.org/10.1016/S2352-3026(17)30182-5

---

**Limits of this review.**
- **Weightlifting-specific evidence is thin.** There is no calorimetry for whole Olympic-lifting sessions, no measured sweat rates for weightlifters, and only one RMR study in weightlifters.
- **EA figures are estimates.** They are planning figures built on assumed body fat and the app's own training estimate, not measurements.
- **Some sources were read as abstracts only**, as marked above.
- **The Danish Health Authority's own pages could not be opened**, so its sleep and activity recommendations are cited through DR and SIF.
- **Scripts.** The worked numbers came from scripts in the scratchpad: `targets-review/calc/`, `energy-calc/`, `rate-calc/`, `protein-calc/`, `fatcalc/`, `carbs-src/`, `water/`, `bw/`, `training-calc/` and the `verify-*` folders. They imported from a removed worktree and will not run as they are.