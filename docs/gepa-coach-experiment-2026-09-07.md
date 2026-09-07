# Coach GEPA experiment — 7 September 2026

**Decision: retain the current Coach prompt.** GEPA was installed and run against the real Coach/tool engine using synthetic accounts. Three revisions were proposed; none demonstrated a reliable overall improvement. No optimized prompt, optimizer service or background job was deployed to Railway.

The implementation is in [scripts/gepa](../scripts/gepa/README.md). The conversational paragraph was extracted into [coach-style.ts](../lib/agent/coach-style.ts) without changing the generated system prompt. A regression test fingerprints the surrounding health, privacy, evidence and review policy. The app's normal type checking and lint now cover the evaluation runner too.

## Measured result

| Comparison | Mean score | Outcome |
| --- | ---: | --- |
| Original prompt, eight validation cases | 0.9453 | Retained |
| GEPA revision that reached full validation | 0.8281 | Rejected |
| Conversational validation cases only: original → revision | 0.9271 → 0.9375 | Small exploratory gain, insufficient for promotion |

The other two revisions failed GEPA's small-batch acceptance test and did not reach full validation. One contained incomplete text after reflection hit its output limit. The revision reaching full validation improved a three-case conversational comparison from 2.6875/3 to 2.875/3, but lost on the wider checks.

That revision proposed storing a ten-mile ride as 16.09 km instead of the expected 16.09344 km. This is a 3.44-metre rounding difference, which failed the deliberately strict conversion check. The original prompt also produced that rounding on an extra seed evaluation during restart. This finding calls for a predefined precision/tolerance policy in a future benchmark; it does not establish that the revision caused the issue. The small tone-only gain was also within the observed sampling variation.

GEPA selected the **original** prompt. Consequently, the subsequent held-out groups both used identical prompt text: 12 separate scenarios, two repeats per group, 48 baseline samples total. Their means were 0.9167 and 0.9245; individual group/repeat means ranged from 0.8750 to 0.9740. Each group had one incomplete cardio-retrieval response. These are measurements of baseline variability, **not a before/after improvement**. No held-out results were fed back into GEPA.

Across setup, search and repeated checks, 106 scenario evaluations completed. There were 295 successful model calls: 206 Coach, 86 judge and three reflection calls, plus one small routing diagnostic. Confirmed provider cost, reconciled with the key's usage change, was **$1.252004325**. Conservative accounting including uncertain-failure reservations was $1.354242825, below the $2 experiment cap.

## What the evaluations found

These examples use invented requests and journals:

- For a low-energy check-in and a busy family evening, the baseline sometimes declared that taking training off the table was the best choice, then added other activities or another question. The rubric penalized that excess direction and multiple suggestions.
- Sleep tables sometimes displayed both hours/minutes and decimal hours in the same cell. The tested GEPA revision added a general instruction to avoid that duplication.
- Greetings, respecting an explicit decline, reviewed sleep entries, swimming units and reported food ingredients often performed well. Exact conversion and occasional incomplete retrieval responses remained inconsistent.

The results support keeping review-before-save and the existing server-side validation. They do not support claiming that the optimized text improves Coach reliably, or that the baseline is correct for all conversations.

## Method and limits

- **Model:** `google/gemini-3.8-flash` through OpenRouter, matching the deployed Coach. Task requests used the production adapter and normal engine limits. Reflection and judging retained the same zero-retention/no-training routing constraints.
- **Data:** 32 synthetic scenarios: 12 training, eight validation, 12 held-out. Fresh disposable users in the `_test` database; multi-turn cases kept their journal and recent conversation within the episode. Clock fixed to noon in Copenhagen on 7 September 2026. No production journals, conversations or photographs were read or reused.
- **Scoring:** deterministic retrieval, date/unit, proposal, ingredient-evidence, visual and no-unconfirmed-write checks; a fixed 0–4 judge rubric for relevance, agency, naturalness and concision. The judge was calibrated with clear and subtle examples reviewed by the coding assistant. There was no independent human panel. Same-model judging/reflection and the small synthetic dataset limit the conclusions.
- **Search:** GEPA 0.1.4, seed 17, three proposals, 56-metric-call ceiling; the completed search reported 34 metric calls. Checkpoint restart performs additional seed calls outside that counter, all included in dollar accounting. Perfect logging cases used some reflection budget despite being outside the editable style paragraph's direct influence.
- **Setup interruptions:** a judge-only temperature parameter excluded the available zero-retention route and was removed; production-style requests worked. Rate limiting led to paced, bounded retries. A truncated judge response required a larger evaluation output allowance. The rubric was fixed before completed candidate selection and held-out evaluation. These interruptions and extra calls are included in the totals.
- **Scope:** text/journal scenarios. Existing image ownership, tagging, streaming and authentication regression tests ran separately; this was not a multimodal extraction optimization or a user trial.

After the run, the harness was hardened to distinguish confirmed bills from conservative reservations, reserve against maximum endpoint pricing, detect truncated evaluator output, validate checkpoint metadata and explicitly label identical-prompt comparisons. Those safeguards do not change the retained production prompt.

## Reproducibility

Raw synthetic traces and GEPA checkpoints remain local under `/tmp/lift-gepa-20260907-*`, outside the public repository. The executed runner/Python source hashes were retained with the final run. The original app implementation came from source `340a19f` (its running Railway application was the preceding `5c46913` release).

| Component | SHA-256 |
| --- | --- |
| Baseline conversational text | `318d9a79b6fb8af5048b9031ea9ff96b4fdb536f16138a8709f5efa949475945` |
| Full-validation GEPA revision | `897d41bdfae2f091c38e457e83b44ae429473fe5cf16f06c0b6b975516f28cfd` |
| Fixed policy with style placeholder | `6a22b1393e482d8e144d3e41c232add1a9da43486bea6ac416cf090f3585387b` |
| Final judge rubric | `71cecf5b0a35655c9a9872f6dc53ce4c232340865be6f0ad74f0ff99845dfe4d` |
| Scenario source | `cc685e9b341cbe62d3ac3cbaa42588704225cbc21e5aa637d06b94cd1a2ad782` |

Local verification passed: type checking for app and runner, lint, the production build, a no-spend bridge/pricing contract check, 23 progression tests and 69 domain/database/authentication tests, including the new fixed-policy test. No live prompt update is justified by this experiment; the existing website release remains in service.
