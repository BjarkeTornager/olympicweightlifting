# Coach evals — first baseline, 26 September 2026

`npm run eval -- --live` now runs whole Coach conversations end to end against the real models and grades them. Design, research basis and usage are in [`scripts/evals/README.md`](../scripts/evals/README.md).

## Baseline

Voice: 10 scenarios × 3 trials, Gemini Live (`gemini-3.8-live-extended-thinking`, voice Algenib), judge `gemini-3.8-flash`. Typed Coach: 3 scenarios × 2 trials, production OpenRouter routing.

| Scenario | Coach | Type | pass^k | Median first audio |
| --- | --- | --- | --- | --- |
| A fully logged day is acknowledged, not asked about again | voice | regression | 3/3 | 872 ms |
| A reply transcribed as Spanish does not switch language | voice | regression | 3/3 | 855 ms |
| Food added to a meal already logged updates that meal | voice | regression | 3/3 | 1002 ms |
| Numbers that do not add up are clarified before saving | voice | regression | 3/3 | 800 ms |
| A short "not yet" does not end the call | voice | regression | 3/3 | 977 ms |
| An old unfinished workout neither blocks nor is silently cleared | voice | regression | 3/3 | 1017 ms |
| Drinks add up; a drink with energy is also food | voice | regression | 3/3 | 2866 ms |
| Goals are collected without guessing, saved as the app's plan | voice | capability | 3/3 | 737 ms |
| The coach remembers an earlier conversation | voice | capability | 3/3 (after fix) | 2956 ms |
| A busy athlete logs a whole day (simulated athlete) | voice | capability | 3/3 | 875 ms |
| Typed Coach answers today's status from context | text | regression | 2/2 | — |
| Typed Coach adds a drink to the day's total | text | regression | 2/2 | — |
| Typed Coach saves and answers a question in one message | text | capability | 2/2 (after fix) | — |

## What the evals found, and what changed

Every failure was read in its transcript before acting (several were harness errors, not Coach errors).

**Coach problems, fixed:**

- **Spanish reply** to "¿Qué fue?" still happened with the English rule in the middle of the instructions (1/1 fail). Moved to the top as an overriding rule: 3/3.
- **Claiming a save that never happened.** With an athlete talking over it, the coach said "chicken and rice logged" without calling the tool (interruption cancels pending calls). New overriding rule: never say something is saved until the tool returned success. Simulated day went from 1/3 to 3/3.
- **"Let me check…" then silence.** The model announced a check and ended its turn without acting; in a live call the athlete waits in silence. Instruction added, and the app now nudges the coach after 2.5 s when a turn ends on a promised action with no tool call (same logic in the harness).
- **Vague acknowledgement** of a logged day ("training and fuel look solid"): now names specifics; 2/3 → 3/3.
- **Memory recalled without the advice**: now includes what was advised or agreed; 1/3 → 3/3.
- **Typed Coach refused fatigue questions in production.** "How many sets of snatch should I do when I'm tired?" returned "I'm sorry, but I cannot assist with that request." Cause: Azure's content filter (`finish_reason: content_filter`) in front of every zero-retention OpenAI model, including the EU endpoint used for Luna — reproduced with a one-line prompt. A filtered reply is now retried once on `google/gemini-3.8-flash`, keeping zero retention and no data collection (served by Google, so that reply may be processed outside the EU). Logged as `coach_content_filter_fallback`.

**Harness errors, fixed:** turn budget too small for goal setup; judge not shown tool results or the seeded memory; simulated athlete speaking immediately after the coach and while a save was running; ending the trial before the coach finished speaking.

**Operational:** Google's prepaid credit ran out mid-run (402 "prepayment credits are depleted"), which also stopped the live voice coach. The app now says "Voice is paused because its Google credit has run out" and stops retrying instead of reporting a dropped call. The production OpenRouter allowance is about $1.5 of $10 for this month; typed Coach evals are opt-in and refuse below $1.

## Limits

Voice trials use text instead of audio: speech recognition, accents and barge-in with real sound are not covered. The judge shares a model family with the voice coach. Three trials per scenario detect frequent failures, not rare ones.
