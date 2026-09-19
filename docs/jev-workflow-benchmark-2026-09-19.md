# Jev: actual Coach workflow benchmark — 19 September 2026

Jev is promising as an offline or observational quality checker. With a five-question rubric, it flagged **7 of 9 unambiguous problem turns at the preset 0.85 threshold**, with **no turn-level false alarms among 64 clean turns**. It missed two instances of additional confirmation friction at that threshold and sometimes assigned extra, incorrect error categories. These results support review and regression testing; they do not establish that automatic correction or deployment would improve the website.

The experiment also found concrete Coach issues to fix. No application behavior, production configuration, or deployed website was changed.

## What was tested

- **48 conversations / 76 turns:** 12 scenario families, English and Danish, two runs each. Every conversation used a fresh synthetic account in the local test database.
- Actual `runTurn`, current Coach prompt, tools, validation, database writes, saved receipts, and conversation history. Model: `openai/gpt-5.6-luna`, using the application's OpenRouter privacy configuration. Direct logging was enabled, as in the current web flow.
- Scenarios: repeated equal sets, workout completion, active-set corrections, missing-weight follow-ups, unsaved previews, sleep/water preservation, running corrections, third-party reports, empty records, declined advice, unknown ingredients, mixed save/question requests, and instructions embedded in journal notes.
- **40 authored controls:** ten families, each with a good and flawed case in both languages. These deliberately introduced unsupported claims, ignored preferences, false save claims, omitted questions, duplicate sets, incorrect water totals, and dropped sleep values.
- Jev `jev-1.13.0` evaluated all **116 cases**, without request failures. It received the user message, relevant conversation history, final reply, before/after journal facts and final receipts. It did not receive reference labels or test failure messages.

The Coach question rubric was fixed before collection. Reference labels were reviewed and frozen before Jev inference. Three ambiguous actual replies were marked before scoring and excluded from primary semantic metrics, while their predictions and workflow results remain available. These were an English phrase about a partner's achievement being “logged here” and two Danish turns asking whether a set was successful or missed.

## What the Coach test uncovered

| Behavior | Observed result | Practical implication |
| --- | --- | --- |
| Append identical sets and finish the workout | All four conversations preserved two equal sets and finished one workout | No deduplication or premature-completion error in these cases |
| Correct an ongoing set from 80 to 85 kg | Three correction turns failed after a successful initial save; the fourth conversation stayed in an outcome-clarification loop | Ongoing-set correction needs a supported action and clear tool guidance |
| Correct running distance from 5 to 4.8 km | Both English corrections committed; both Danish corrections produced valid pending reviews, leaving the saved distance at 5 km | Extra confirmation friction in direct-logging mode; no incorrect distance was written |
| Save sleep and answer a lifting question in the same message | All four saved sleep but omitted the requested explanation | The save path drops the second request |
| Missing weight, preview-only instructions, sleep/water preservation, declined advice, unknown ingredients, third-party sets, untrusted notes | Prescribed state checks passed; reviewed replies had no unambiguous semantic issues | These checks passed within the limited synthetic scenarios |

Journal checks passed on **69/76 turns**. Including the four unanswered questions, **65/76 turns and 38/48 conversations reached their full prescribed outcome**. These are strict completion counts for this deliberately difficult script, not estimates of production quality. The seven state-check failures were unchanged records or unfulfilled saves, including two ambiguous clarification turns; no erroneous saved value or unintended mutation was observed in the collected Coach turns.

The source explains the two main implementation gaps:

1. [`update_session`](../lib/agent/actions.ts) operates on completed history, while `log_sets` appends performed sets. The current action surface lacks a narrow replacement operation for an already logged set in an active workout. Observed model attempts used the history-edit path and were rejected.
2. [`runTurn`](../lib/agent/engine.ts) stops after preparing a change and replaces the reply with a stock save/review message. That path cannot deliver the additional requested explanation in these mixed-request cases.

## How well Jev detected problems

“Alarm” means at least one issue has a positive score at or above 0.85. “Exact labels” means all five yes/no classifications match the reference labels at the ordinary 0.50 decision boundary.

| Evaluation group | Problems caught at 0.85 | Clean turns falsely flagged at 0.85 | Exact five-label agreement |
| --- | --- | --- | --- |
| Actual Coach turns, excluding three ambiguous cases | **7/9 (77.8%)** | **0/64** | **71/73 (97.3%)** |
| Authored controls, reported separately | **18/20 (90%)** | **0/20** | **28/40 (70%)** |

The nine actual problem turns comprise three failed active-set corrections, two unnecessary-review cases and four omitted questions. Jev detected all three correction failures and all four omissions at 0.85. It scored the Danish running-review cases at **0.72 and 0.71**, below the threshold.

For the deliberate controls, the two missed high-confidence alarms were **duplicate-set errors**, scored **0.66 in English and 0.76 in Danish**. This is a reason to keep deterministic set-count and state-transition checks authoritative.

At the descriptive 0.50 boundary, Jev raised an alarm on all nine actual problems and all twenty flawed controls, with no clean-case alarms. The 0.85 threshold was not changed after seeing this result; a lower threshold still needs independent validation.

The original three questions—unsupported claims, ignored constraints, false save claims—caught **0/9** actual problems at 0.85. Adding explicit questions for **missed requests** and **incorrect or unfulfilled journal changes** was essential. This is an improvement in evaluation coverage, not a measured improvement to the Coach itself.

Category accuracy was weaker than alarm detection. On two English correction failures, Jev marked an omitted task even though the reply explicitly acknowledged inability, which the rubric allows. Controls produced 17 incorrect additional labels, often confusing a wrong statement with a wrong journal mutation or treating an incorrect answer as an omitted answer. All were within already flawed controls, so they did not create clean-case alarms. Error-type labels should therefore be reviewed before choosing a repair.

## Latency, costs, and verification

- Jev on actual Coach turns: **297 ms median, 401 ms p95**. These are sequential offline audit requests, not measured added latency in the website.
- Coach workflow turns: **9.21 seconds median, 36.63 seconds p95**, including tool rounds and local persistence.
- Coach: **152 requests, $0.107261891** in provider-reported usage cost.
- Jev: **116 requests, 136,067 input tokens, $0.005714814** at the documented input-token price.
- Total for this expanded experiment: **$0.112976705**, approximately **11.3 US cents**. Previous benchmark runs are not included. Repeated cached prompts contribute to the low Coach cost; this is not a production cost forecast.
- Caps were $1 for Coach and $0.10 for Jev. No inference retries or uncertain request costs occurred.
- All **48 synthetic accounts were deleted**; a database query restricted to their IDs confirmed zero remaining.
- **25 relevant automated tests passed**, including direct logging, undo/isolation, workout continuity, cardio, health, and Jev checks. Final Jev checks, full TypeScript checks, and lint passed. Collection source hashes still match the files used by the run.

## Recommendation and limits

Fix active-workout corrections and preserve answers to additional requests after a save, then rerun this regression suite. Use Jev's expanded rubric to flag conversations for review or as an additional offline release check. Keep deterministic persistence checks in charge of journal invariants. This experiment does not justify automatic retries, repairs, or blocking user saves based solely on Jev scores.

The dataset is small and authored; labels were reviewed by an assistant, without independent human adjudication. Language variants, repeated runs and paired controls are correlated. Most successful save replies are the same English application-generated text, including in Danish conversations. Zero observed false alarms does not establish a zero production false-alarm rate. This run did not test browser interaction, HTTP authentication, real athlete data, meal creation, images/video, production retention arrangements, or user outcomes after integrating Jev.

The [machine-readable evidence](jev-workflow-benchmark-2026-09-19.results.json) preserves manifests, frozen cases and annotations, all Jev predictions, before/after outcomes, costs, exclusions and cleanup verification. Private raw tool traces are in `/tmp/lift-jev-workflow-OQGh6d`. See [run instructions](../scripts/jev/README.md) and the [earlier classifier benchmark](jev-benchmark-2026-09-19.md).
