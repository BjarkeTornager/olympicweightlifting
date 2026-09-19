# Jev benchmark results — 19 September 2026

**The live Jev benchmark completed all 132 synthetic cases.** Jev is promising for offline reply checks and as a supplementary intent signal, but the errors below argue against using its classification alone to trigger writes or restrict Coach's tools. Only invented examples were sent to TypeSafe. No production behavior changed.

## Live results

The successful run used `jev-1.13.0`, the original fixtures/questions, and the preset 0.85 acceptance threshold. Dataset and question hashes match the baseline manifest created before live inference. Full metrics, manifests, interrupted attempts and accounting are preserved in [the results JSON](jev-benchmark-2026-09-19.results.json).

| Evaluation | Cases | Individual-label accuracy | All labels correct | Accepted-label coverage | Accuracy among accepted labels |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev intent, calibration | 60 | 97.7% | 91.7% | 85.7% | 99.2% |
| Jev intent, held out | 40 | 97.5% | 87.5% | 80.5% | 99.4% |
| Jev intent, held out, English | 20 | 99.0% | 95.0% | 84.0% | 100.0% |
| Jev intent, held out, Danish | 20 | 96.0% | 80.0% | 77.0% | 98.7% |
| Jev reply checks, calibration | 16 | 100.0% | 100.0% | 89.6% | 100.0% |
| Jev reply checks, held out | 16 | 100.0% | 100.0% | 87.5% | 100.0% |

For held-out intent, all five labels were correct in 35/40 cases, versus 26/40 for the rules baseline: a 22.5 percentage-point improvement. At the preset threshold, 161/200 individual decisions were accepted and 160 were correct. The remaining 39 decisions would require fallback. These atomic figures do not demonstrate that an entire routed Coach workflow is correct.

The 32 reply cases contain 16 deliberately flawed replies and 16 positive controls. All 96 binary labels matched, including every deliberately introduced flaw at the ordinary 0.5 yes/no decision boundary. Some positive and negative decisions were below 0.85 certainty, so a thresholded checker would still abstain on them. These controls are small and relatively clear; they do not establish 100% accuracy on real Coach responses.

Held-out intent latency was approximately **288 ms median / 356 ms p95** from this machine, including the HTTP round trip. The complete run used 122,903 input tokens and 16,873 output tokens, for a **$0.005162** estimate at the documented input rate. Including successful calls from interrupted attempts and a diagnostic request gives **$0.007835** in known usage-priced estimates. Retaining maximum-input reservations for all three uncertain/invalid attempts brings conservative accounting to **$0.015899**, below the $0.10 combined allowance. These are price calculations, not billing receipts.

## Errors and what they mean

- **Mixed Danish request lost its second purpose.** “Jeg spiste suppe til frokost, og design også næste uges løfteprogram” was classified as `report` at probability 0.85 instead of `mixed_or_unclear`. This was the one accepted held-out mistake. A router using this label to expose only logging tools could omit the programme request.
- **Finishing an exercise was mistaken for a new report.** Both languages' calibration example saying squats were finished but jerks had not started received `report` with 0.96/0.98 probability, although the intended label was status/recap. The separate personal-event probabilities were lower, at 0.61/0.67. This supports evaluating several signals rather than treating one high-probability intent as authorization.
- **Negation and ownership remained imperfect.** The held-out “I didn't do the planned deadlifts” examples were treated as personal-event reports with probabilities 0.67/0.69. A Danish message about a training partner finishing her workout produced 0.53 for the athlete's own workout completion. The 0.85 threshold would abstain on these errors.
- **Some genuine performed sets were missed.** One calibration final-set report and a Danish held-out report of yesterday's completed cleans were classified as not reporting new sets at just 0.51. Held-out new-set recall was 5/6 at the 0.5 boundary, an important limitation hidden by the high aggregate accuracy.

No held-out false positive for the personal-event or whole-workout-finished questions met the 0.85 acceptance threshold: 0/26 and 0/34 negative examples, respectively. That small result is encouraging, not proof of safe automatic writes. Several ground-truth distinctions, especially status versus a new report, should also receive independent human review.

## Runtime issue found and fixed

The first connection attempt failed inside the network sandbox. After network access was allowed, two runs stopped in the calibration split because the adapter required nearly exact probability sums. A diagnostic response and subsequent numeric diagnostics showed two-decimal values, including a distribution totalling 0.99.

Validation now allows cumulative rounding error only for distributions whose values have two-decimal precision. Range, option membership, full option coverage and highest-probability choice checks remain. Raw probabilities are retained; no normalization, label changes, question changes or threshold tuning occurred. A regression test covers 0.99/1.01 sums and rejects invalid mass and inconsistent higher-precision values. One subsequent full pass completed without a transport or validation failure. Earlier partial runs are excluded from accuracy metrics and retained for accounting.

## Included

- 100 invented intent cases across 50 English/Danish families: reports, corrections, recaps, future plans, questions, ongoing/completed workouts, missing information, mixed requests and adversarial text.
- 32 invented Coach-reply checks: paired good/flawed responses for unsupported personal claims, ignored constraints and false claims of saving.
- Fixed calibration/held-out family splits, a rules baseline, one batched Jev request per case, strict response validation, and a $0.10 maximum local run budget.
- Reports with class precision/recall, atomic and whole-case accuracy, abstention, high-probability false event/finish decisions, probability bins, binary Brier scores, latency and usage-priced estimates. Manifests hash fixtures, questions and runner sources.

Implementation and commands are documented in [`scripts/jev/README.md`](../scripts/jev/README.md). Run `npm run benchmark:jev` for the local baseline or `npm run benchmark:jev -- --live` after adding the key to the ignored `.env.local` file.

## Observed local baseline

These are results of the new deliberately simple bilingual rules classifier, **not Jev results or measurements of the production Coach**. Every intent case has five labels; “all labels correct” is the stricter whole-case measure.

| Split | Cases | Individual-label accuracy | All labels correct |
| --- | ---: | ---: | ---: |
| Calibration | 60 | 88.7% | 71.7% |
| Held out | 40 | 84.5% | 65.0% |
| Held out, English | 20 | 85.0% | 65.0% |
| Held out, Danish | 20 | 84.0% | 65.0% |

The held-out rules baseline falsely marked two of 26 negative examples as personal-event reports. It made no false whole-workout-finished decisions in 34 negative examples. These are classification counts; no journal writes were attempted. A zero false-positive count does not establish good detection of positive cases or general safety. The JSON report includes class recall and other errors.

The original local baseline files are in `/tmp/lift-jev-iLaYZX/`; the complete live run is in `/tmp/lift-jev-Kaog3L/`. These temporary directories contain detailed local artifacts. The results JSON linked above preserves the complete aggregate report and provenance in the repository.

## Verification

- Seven benchmark contract/metric tests pass, using fake network transports. They cover split leakage, excluded labels, malformed/rounded responses, probability versus confidence, request destination, no retries, budget reservation and failure accounting.
- Project TypeScript checks and ESLint pass, including the benchmark directory.
- The non-database test run passes: 166 passed, 25 database-dependent tests skipped, zero failures. The initial broader attempt could not connect to the configured disposable PostgreSQL database because the sandbox denied the local connection. Database integration behavior has not been reverified by this change.
- The full baseline runs successfully with no API key, and the live run completes 132/132 cases with a locally configured key. No dependency was added. There are no application routes, database migrations or runtime Coach changes.

## Limits on interpretation

The examples and labels are assistant-authored and have not received independent human annotation. Danish examples use Danish message/reply text with English background context. The reply set is a collection of authored controls, not a sample of real Coach responses. The preset 0.85 threshold is exploratory and has not been tuned against either split. The benchmark does not measure avoided downstream calls, net savings or complete Coach workflows.

The recommended next implementation is an offline checker applied to saved synthetic Coach outputs, with human-reviewed labels and harder near-miss examples. For intent routing, first evaluate Jev as an advisory signal through the actual Coach harness, preserving all tools and existing write validation. Treat the current held-out set as consumed: any prompt changes require new held-out families. Later production use still needs a compatible provider data-retention arrangement before private content is sent. No production integration is justified solely by this small benchmark.
