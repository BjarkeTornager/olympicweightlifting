# Synthetic Jev benchmark

This developer experiment evaluates narrow text decisions for Lift Journal. The original classifier benchmark does not connect to a database or run Coach tools. The optional workflow experiment below uses disposable accounts in a local test database. Neither changes production routing or deploys anything. All inputs are invented fixtures.

## Run

From the repository root:

```sh
# No credentials or network calls: validate fixtures and measure the rules baseline.
npm run benchmark:jev

# First add TYPESAFE_API_KEY to the ignored .env.local file, or export it securely.
# Never prefix it with NEXT_PUBLIC_ or paste it into a command recorded in history.
npm run benchmark:jev -- --live
```

Live mode calls only `https://api.typesafe.ai/v1/systemone`, pins `jev-1.13.0`, and sends the fixture's state plus the fixed question set. Labels, family IDs and evaluation splits are excluded. The default mode does not read `.env.local`. A missing key stops live mode before dispatch.

Optional arguments are `--split calibration`, `--split heldout`, `--limit 4`, and `--max-usd 0.05`. The default split is all and the maximum permitted budget is $0.10. A limited run is only a subset; its manifest records exactly how many cases were selected. Every invocation creates a fresh private `/tmp/lift-jev-*` output directory and prints its path. Repeated invocations spend against separate local run caps; they are not a shared account budget. There is no automatic resume or retry.

## Dataset and interpretation

- **100 intent cases:** 50 families, each with English and Danish wording. Thirty families are calibration and twenty are held out. They cover reports, plans, corrections, questions, recaps, complete/partial workouts, repeated equal sets, missing facts, quoted examples, mixed requests and prompt injection.
- **32 reply checks:** eight families with a good and flawed reply in each language. Four families are calibration and four held out. They check unsupported personal claims, ignored conversational constraints and false save claims. These are authored controls, not outputs sampled from the deployed Coach.
- Related variants always share a split. Labels and the threshold are fixed before live inference. These labels were authored by the assistant, without independent human annotation. Danish messages/replies use English background context.
- The rules baseline covers intent only and uses simple bilingual patterns. Its one-hot decisions are not probabilistic confidence estimates. It is a comparison baseline, not an existing production classifier.

Jev answers five atomic questions for an intent case and three for a reply case. It sees all independent questions in one request. A correctly recognized report with missing weight/reps remains incomplete: this experiment does not authorize or perform saves.

The preset acceptance threshold is 0.85. Choice acceptance uses the selected option's probability, not Jev's separate `confidence` statistic. `mixed_or_unclear` always abstains. Noul accepts a yes or no only when its probability is at least 0.85. Reported coverage and accuracy are per atomic decision, not the probability that the whole workflow is correct. No threshold is optimized against the held-out cases.

## Outputs

`manifest.json` records dataset/question/source hashes, model, label provenance, threshold and selected scope. `responses.jsonl` contains validated decisions and token usage for completed live cases. `baseline.json` contains the local rules results. `report.json` and `report.md` summarize:

- Atomic and whole-case accuracy, per-class precision/recall, confusion counts, false positives/negatives, abstention and accepted accuracy by suite, split, language and question.
- Confident false-event and whole-workout-finished decisions; these are semantic errors, not actual erroneous saves.
- Reliability bins, binary Brier scores and p50/p95 latency. Rule-baseline probability metrics are only mechanical diagnostics of one-hot outputs.
- Successful token usage, usage-priced cost estimates and conservative accounted costs for uncertain failures.

HTTP errors, timeouts, invalid/missing answers, changed model versions, malformed distributions and oversized responses stop the live run, preserve a partial report, and are not counted as classification failures. No raw provider error or credentials are written. Results are never labelled complete after a failed request.

Live testing found that Jev rounds option probabilities to two decimals, producing sums such as 0.99. Validation permits the cumulative half-cent rounding error only when all option probabilities use that precision; other distributions must sum to one within numerical tolerance. It still validates the complete option set, each probability's range, and that the chosen option has the highest probability. Scoring keeps the original probabilities without renormalization or changing the 0.85 acceptance threshold.

Costs use TypeSafe's documented $0.042 per million input tokens; output is free. Each request reserves the full documented 64,000-token request allowance before dispatch and replaces the reservation with reported usage after a valid response. Failed or uncertain calls retain the reservation. This is conservative accounting at the documented price, not a billing receipt or a provider-enforced spending cap. Recheck pricing before future runs.

## Verification and promotion

```sh
node --import tsx --test tests/jev.test.ts
node_modules/.bin/tsc --noEmit -p scripts/jev/tsconfig.json
node_modules/.bin/eslint scripts/jev tests/jev.test.ts
```

Tests cover split leakage, label exclusion, response validation, probability semantics, fixed destination, budget enforcement, failure accounting and evaluation metrics. They use a fake transport and make no inference calls. The benchmark is included in normal type/lint checks; the contract tests run with `npm test`.

Before any production proposal, review labels and disagreements, compare held-out and Danish performance, and test end-to-end behavior through the Coach evaluation harness. This initial benchmark does not measure avoided downstream calls, net savings, image understanding or live Coach quality. Do not replace the existing GEPA judge's explanatory critique with these primitive scores. Private production traffic also needs a confirmed provider retention arrangement compatible with the app's current policy.

Sources checked 19 September 2026: [API](https://docs.typesafe.ai/api), [models and pricing](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence), [known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13). See the [integration assessment](../../docs/jev-assessment-2026-09-19.md).

## Actual Coach workflow experiment

`workflow-collect.ts` runs 12 synthetic scenario families in English and Danish, repeated twice: 48 isolated conversations / 76 turns. It invokes the application's `runTurn`, current prompt, tools, validation and journal persistence with direct logging enabled. It uses `openai/gpt-5.6-luna` through the application's OpenRouter privacy settings. It does not test the browser, HTTP authentication, image/video input or a deployed production instance.

The collection requires a reachable `TEST_DATABASE_URL` on localhost ending in `_test`, with the existing schema. Database imports happen only after selecting that URL. Each account uses a new UUID and `example.test` address; only that account is deleted in `finally`. Account creation/deletion is logged for recovery. No migrations are performed. A hard process exit can prevent cleanup; use `accounts.jsonl` to identify only this run's leftover accounts.

```sh
# Reads ignored .env.local; optional OpenRouter key fallback is the local key file.
npm run benchmark:jev:workflows -- --live
# Limit a regression run to the affected families (still two runs per language):
npm run benchmark:jev:workflows -- --live --families strength_correction,cardio_preservation,mixed_request,preview_only

# Review every trace and create annotations.json in the printed private run directory:
# { "trace-id": { "expected": { "unsupported_claim": false,
#   "ignores_constraint": false, "false_save_claim": false,
#   "missed_requested_task": false, "incorrect_journal_change": false },
#   "rationale": "Concrete reason for these five labels" } }
# Add "ambiguous": true to an annotation before freezing if wording prevents
# a confident reference label; it is evaluated but excluded from primary scores.
# Freeze independently reviewed labels and the 40 preset paired controls first:
npm run benchmark:jev:audit -- /tmp/lift-jev-workflow-RUNID
# Then evaluate the frozen cases:
npm run benchmark:jev:audit -- /tmp/lift-jev-workflow-RUNID --live
```

Coach collection has a $1 per-invocation ceiling, 350-call and 50-minute limits, no retries, bounded response size, and a ledger of conservative reservations replaced by provider-reported costs. Current endpoint prices, including tier overrides and cache writes, are checked before dispatch. Input reserves use one token per UTF-8 request byte plus 4,096 protocol tokens; output reserves use the actual output-token limit. Jev audit has a separate $0.10 ceiling and the same transport guards as the original benchmark. Re-running collection starts a new spend cap; audit refuses to run twice in the same directory.

The new rubric checks omissions and incorrect journal changes as well as the original three reply issues. The five-question rubric is frozen before Coach collection. Labels are reviewed before Jev inference; they are never sent to Jev. Intermediate tool outputs may say `saved:false` before the engine commits, so evaluation supplies final saved receipts and before/after journal facts. Execution errors are reported separately and excluded from semantic judge scoring. Actual Coach samples and authored positive/negative controls are reported separately, including error-detection precision/recall at 0.50 and the preset 0.85 threshold. Repeats, language variants, and paired controls are correlated observations, not independent evidence of population-level accuracy. Synthetic labels reviewed by an assistant are not independent human adjudication.
