# Hard Coach benchmark: first results and experiments — 27 September 2026

The Jev workflow benchmark reached 60/60, so it could no longer tell a better Coach from a worse one. [scripts/coach-bench](../scripts/coach-bench/README.md) is a harder benchmark: 26 scenarios in English and Danish covering the difficult parts of typed Coach's tool use. Each conversation is checked on the saved journal, the review cards and, for questions, the reply. This report covers the first results, the Coach fixes they led to, and three experiments run on it. All runs used Luna with production prompt caching, on disposable test accounts.

## Results

| | Passed (3 repeats) | Rounds per turn | Median time per turn |
| --- | --- | --- | --- |
| `main` (#34) | 143/156 (92 %) | 1.94 | 8.8 s |
| With the fixes below | 152/156 (97 %) | 1.87 | 8.0 s |

The fixes run was made before the last two fixes (wrong-id errors and drink volume). A focused rerun of the scenarios those touch (log and answer, set correction, run correction, identical sets, a soda can; 30 conversations) passed 30/30.

## What the benchmark found, and the fixes

Every failure was read in its transcript, with the tool errors Coach received, before anything was changed. Two checks turned out to be too strict and were corrected in the benchmark: a clarification without a question mark, and an ambiguous "went to bed … woke up" sleep message.

| Failure | Cause | Fix |
| --- | --- | --- |
| "I'm done for today" didn't finish the workout; Coach gave up after three rejected saves | `finish_workout` rejected the `workoutId` the model naturally includes | `finish_workout` and `discard_workout` accept the id of the workout in progress (and reject any other) |
| "One more set at the same weight" took up to 5 rounds or failed | The rules and guards required `find_sessions` for today, although today's sessions are in the day message | Today's sessions count as read, like #34's check-ins, activities and meals; the rules and both tool descriptions say so |
| Weights in pounds weren't saved; Coach asked to confirm the conversion | No rule for pounds | Convert (1 lb = 0.4536 kg, to 0.1 kg), save and say so |
| Danish "samme frokost som i går" repeated nothing (every run) | Luna reads *frokost* as breakfast, as in Norwegian, even when told otherwise in the prompt or tool description | The engine spells out Danish meal words for the turn, and a food lookup or meal save whose type contradicts the athlete's Danish meal word gets a correction back |
| A save plus a question answered only the save (4 of 6) | The model often leaves the change's `answer` field empty | When the message asks something and the change carries no answer, one more round without tools answers it after the receipt |
| A protein shake wasn't saved without its volume | Drinks need millilitres, and Coach asked instead of estimating | Estimate a missing volume (a shake about 300 ml) and say so, as meals already do |
| Rejected set and run corrections sent Coach in circles | A miscopied id was reported as "read it first" or "planned or unknown" | The errors say which id doesn't exist and to copy it exactly |
| Stale reads in tool descriptions | `log_entry` still said to read food_journal before every new meal; `prepare_change` required `find_sessions` for today | Updated to match the rules |

The prompt changes are covered by the prompt-hash test's review note. Health, privacy and evidence text is unchanged.

## Experiments

**GEPA on the `log_entry` tool description.** Six rewrites were proposed from training feedback. None beat the current description even on its small training batch, so the search ended and the current text stays ($0.38). This matches the two earlier GEPA runs: on this Coach, the gains come from engine and rule fixes, not rewording.

**Worked examples in the prompt** (DSPy's "bootstrap few-shot" idea). The shortest passing tool sequences from training conversations became 5 examples (2,300 characters, added to the cached instructions). On validation and held-out scenarios, 3 repeats each:

| | Passed | Rounds per turn |
| --- | --- | --- |
| Current prompt | 91/96 | 1.74 |
| With 5 worked examples | 94/96 | 1.69 |

The difference is three conversations, almost all in one scenario whose cause was fixed separately (drink volume), so it's within noise. The examples also missed the strength category, where they would matter most. Not adopted for now. A retest with a workout example and more repeats could settle it.

**A smaller "core" context.** This left out the prompt paragraphs and tools that only some turns need: photos, routes, web search, programmes, lifting reviews, weekly review, body goals, and the matching `prepare_change` fields. It ran on every scenario that doesn't need them, 2 repeats each:

| | Passed | Input tokens per round | Cost per turn | Median time per turn |
| --- | --- | --- | --- | --- |
| Full context | 97/100 | 29,300 | $0.0016 | 8.4 s |
| Core only | 99/100 | 21,400 | $0.0014 | 7.0 s |

Everyday turns lose nothing with 27% less context, and are 12% cheaper and faster. This supports loading those parts as skills only when a turn needs them.

## Cost

All benchmark runs and experiments together cost about $2.60 of OpenRouter allowance (about $0.002 per conversation). The monthly allowance had $34.78 left afterwards.

## Limits

- **Model:** Luna only; Terra and Astra turns weren't covered.
- **Messages:** scripted, not real. Three repeats detect frequent failures, not rare ones.
- **Scope:** checks read the journal and replies; they don't judge tone.
- **Remaining failures:** these are one-offs such as Danish "bænkpres" logged as a custom exercise.
