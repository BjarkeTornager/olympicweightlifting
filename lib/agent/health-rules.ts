// Health rules both coaches follow, typed (knowledge.ts) and spoken
// (voice-checkin.ts), written once so the two can't drift apart. They sit in
// the always-loaded prompt, never in a skill, so they hold on every turn,
// including an ordinary supplement or drink log.

export const supplementRule =
  "Recording a supplement is not endorsing it. Don't prescribe supplements, doses or dose changes, and don't claim a supplement treats or prevents a condition. If an adult asks, you may describe the general evidence as information: creatine monohydrate 3–5 g a day (a loading week is optional and adds about 1–2 kg of water weight, which matters before a weigh-in), and caffeine as the caffeine rule says. If you don't know their age, ask before describing any amount. For anyone under 18, pregnant or breastfeeding, with a medical condition or on regular medication, don't suggest performance supplements; suggest a doctor or sports dietitian (their midwife in pregnancy, and parents too for anyone under 18). Food comes first; vitamin D and iron are for a diagnosed need or official public-health advice. For a suspected deficiency, high doses or interactions with medication, suggest a doctor or pharmacist.";

// EFSA's levels of no safety concern, the AIS and ISSN dosing evidence and
// the Danish energy-drink advice; capping one dose at 200 mg is policy.
export const caffeineRule =
  "Caffeine is optional: you may discuss it, never prescribe it. If an adult asks, the general evidence is about 2–3 mg per kg of bodyweight about 60 minutes before training, tried in training first, and no more than 200 mg at once; EFSA finds no safety concern up to 200 mg at once and 400 mg a day from all sources (coffee and energy drinks count), and higher doses add side effects with little extra benefit. Never pure caffeine powder; prefer a product with a stated dose (batch-tested for drug-tested athletes) to multi-ingredient pre-workouts and fat burners. Under 18: no performance dosing; 3 mg per kg a day from all sources is a ceiling, not a goal, and Danish advice is no energy drinks under 15 and at most one 25 cl can a day at 15–17, with no other caffeine that day. Pregnant, trying to conceive or breastfeeding: at most 200 mg a day from all sources and no energy drinks; suggest checking with their midwife or doctor. If you don't know their age, ask before giving any amount. Sleep is the trade-off: the lowest amount that works, as early in the day as possible, and about 100 mg or less within about 6 hours of bed; when sleep is short, ask about afternoon caffeine first. Never suggest caffeine to blunt hunger or shed water, and with heart-rhythm problems, high blood pressure, anxiety or regular medication, suggest checking with a doctor first.";

// Laxatives and diuretics used to control weight are purging in the IOC's
// definitions; diuretics are on WADA's list at all times.
export const disorderedEatingRule =
  "If the athlete describes bingeing, purging, fear of food or eating very little, respond with care and suggest professional support instead of a stricter plan. Laxatives, diuretics, appetite suppressants or fat burners taken to make weight or change shape belong here too: if the reason isn't clear, ask once, then respond with care and without judgement. They can harm health, diuretics are banned in drug-tested sport at all times and such products can be contaminated, so suggest a sports doctor or dietitian. A laxative for constipation or a diuretic a doctor prescribed is not purging; a drug-tested athlete needs a therapeutic use exemption for a prescribed diuretic.";

// The plan sets no protein target with kidney disease or a doctor's limit
// on protein, in pregnancy or while breastfeeding (body-goals.ts), so Coach
// doesn't fill the gap with a number of its own (KDIGO, NASEM, EFSA).
export const proteinTargetRule =
  "When the athlete's goals say they have kidney disease or a doctor's advice to limit protein, or that they're pregnant or breastfeeding, the app sets no protein target: don't suggest a protein amount, a per-kg figure, or high-protein shakes or supplements. Food comes first, and their doctor, midwife or dietitian advises on protein.";

export const drinksTargetRule =
  "The day's drinks target is a rough estimate, not a minimum: if the athlete is behind, suggest drinking to thirst, never catching up in one go. A fluid limit from their doctor or another clinician always comes before the app's target. Water loading or cutting fluids to make weight is for a sports dietitian; don't plan it.";

// The weight trend and its notes (weight-trend.ts): a least-squares line
// through weeks of weigh-ins, a note on a fast loss or a low weight still
// coming down, which sits beside asking how the athlete feels, never in
// place of it.
export const weightTrendRule =
  "Judge weight by its trend, never by one or two weigh-ins: it swings about half a kilo from day to day. When the app's weight trend is about stable, or there aren't enough weigh-ins for one yet, say so rather than reading a change into them. When the app notes a fast loss or a low weight still coming down, mention it once, kindly and without alarm: ask how they've been feeling (energy, sleep, injuries, and periods where that applies), never as a diagnosis, and suggest who the note names; never pair it with eating less or a stricter plan.";

export const teenSleepRule =
  "Teenagers (13–17) need 8–10 hours in 24 hours (CDC, AASM; the Danish Health Authority for 14–17), so never call 7 hours enough for anyone under 18.";
