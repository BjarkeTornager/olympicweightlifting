# Cheaper Coach lookups, 3 October 2026

Simple questions about the athlete's own records, such as "How much water have I had today?" or "Hvad var min hvilepuls i nat?", went to Terra. Each cost $0.013 to $0.064 in local tests, while logs and recipes on Luna cost $0.0015 to $0.008. They now go to Luna. Two fixes to Coach's training reads came first, because Luna got lift history wrong without them.

## What changed

- **Routing** (`lib/agent/routing.ts`). Jev splits these questions between `log` and `explain` (about 0.3 to 0.7 each), so they fell below the 0.85 threshold and went to Terra as "uncertain". They now go to Luna, with the reason `lookup`, when all of these hold:
  - the choice is `log` or `explain`;
  - p(log) + p(explain) is at least 0.90;
  - difficulty is mechanical: score below 0.30 and p(2) below 0.05;
  - mutation stakes are below 0.85.

  Everything else that is uncertain stays on Terra. Confident answers route as before.
- **Exercise names** (`lib/agent/read-tools.ts`). `training_summary`, `find_sessions` and `lifting_review` accepted any `exerciseId`. Luna often passed a name such as "back squat", got nothing back and said the athlete had never done the lift. A name now resolves to the id the journal or the catalogue uses. An unknown one is refused with ids to use.
- **Route reason recorded** (`lib/agent/engine.ts`). Each turn's metrics (`routeReason`), its `coach_turn_metrics` log line and its trace's `route` span (`lift.route_reason`) now say why the tier was chosen, as a fixed code such as `lookup` or `uncertain`, never the message. So production can count how many turns the rule moves.
- **Sets for one exercise** (`lib/training.ts`). When `training_summary` is filtered to one exercise, each recent session now lists its logged sets. Before, it gave only totals and the best set per rep count, so "What did I lift on clean and jerk last week?" lost a session.

## Evidence

**Jev's answers.** 214 recorded decisions: 47 messages, 3 runs each, plus 73 held-out probes. Replayed through the new policy:
- all 59 lookup decisions that went to Terra now go to Luna, so all 80 lookup decisions are on Luna;
- the 134 decisions on other messages don't change:
  - Terra keeps small talk, acceptances and confirmations (`mixed_or_unclear`), follow-ups such as "and yesterday?" or "why?", mixed requests, plans, and "Slept 5 hours. Should I skip training today?";
  - logs, corrections and advice stay on Luna, as before.

The matched lookups have difficulty scores of 0.15 at most. The closest controls are "Slept 5 hours. Should I skip training today?" (difficulty 0.71 to 0.77) and "why?" (only 0.70 to 0.72 on log and explain).

**Quality, same message on each tier.** Each turn ran through the real engine on a fresh synthetic account with a seeded journal, the tier forced, and the reply and journal checked:

| | Luna | Terra |
| --- | --- | --- |
| Today's figures, food, health, weight, runs (17 messages) | 33/34 passed, $0.0011 a turn | 34/34, $0.0103 |
| Lift history (3 messages), before the two read fixes | 3/12 | 10/12 |
| Lift history, after the two read fixes | 12/12, $0.0017 a turn | 6/6, $0.0271 |
| Accepting a suggestion (stays on Terra) | 4/14 | 11/14 |

Luna's one miss among the lookups wrote one sentence of a Danish reply in English. Luna also reached its first text sooner: a median of 2.8 s against 3.9 s.

**Hard benchmark, held-out split with production routing** (`npm run bench:coach -- --live --routing --split heldout`, 20 conversations of one turn each):

| | Passed | Rounds per turn | Cost per turn, as measured | Median time per turn |
| --- | --- | --- | --- | --- |
| Before (main at 223fbee) | 20/20 | 1.90 | $0.0110 | 8.5 s |
| After | 20/20 | 1.90 | $0.0037 | 8.3 s |

The measured drop from $0.0110 to $0.0037 is not the effect of routing. Like for like:
- **Moved turns:** four turns moved to Luna, "How many calories have I eaten so far today?" and "What did I have for lunch today?" (whose lunch note holds an instruction Coach must ignore), in English and Danish. Together they went from $0.0378 to $0.0042 and still passed.
- **Per turn:** the "before" run with only those four turns at their "after" cost comes to $0.0093 a turn. So routing took the benchmark from $0.0110 to $0.0093 a turn, about 15%.
- **The rest of the drop**, $0.0093 to $0.0037, was a warmer Terra prompt cache, not routing. Most of it is the two calorie-target turns, which stay on Terra: about 47,500 of their 71,700 input tokens came from the cache before and over 71,000 after, so together they went from $0.1435 to $0.0336.
- **Against the 27 September report:** that report ran Luna only and got 91/96 on validation and held-out together, so it isn't a like-for-like comparison. This run has no failures.

## Expected saving

A lookup that moves saves about $0.009 (today's figures) to $0.025 (lift history) with a warm cache. At an assumed 4 to 1 mix, that is about $0.012 per lookup.

At one or two such questions a day, an active athlete saves about $0.37 to $0.75 a month. The owner's usage page (Settings › Usage) counts Coach messages per person, which bounds the real rate.

Production Terra traffic has a colder cache than these runs. An uncached first Terra call cost $0.059 against Luna's $0.0065, so the real saving is probably higher.

## Limits

- **One seeded journal and one clock.** Most messages ran twice per tier, which can't tell apart a difference of a few percent.
- **Jev sees only the latest message.** A short follow-up can reach Luna whenever Jev puts its mass mostly on `log` and `explain` and sees no judgment in it. "Og min puls?" ("And my pulse?") did in both recorded runs (0.95 and 0.97 on log and explain), and Luna then relies on the conversation history to know what it refers to. Follow-ups with more of the mass on `mixed_or_unclear`, such as "and yesterday?" and "og i går?", stayed on Terra. `tests/agent-routing.test.ts` records "Og min puls?" going to Luna as accepted behaviour.
- **Small talk and acceptances stay on Terra.** Luna equalled Terra on thanks and confirmations. But it prepared the agreed plan for review in only 4 of 14 acceptances, so this group needs its own change first.

Spend for this step was $0.50 of OpenRouter use, plus under $0.01 for Jev.
