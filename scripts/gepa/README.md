# Offline Coach prompt optimization

This opt-in developer experiment runs **GEPA 0.1.4** against the actual Coach engine and its account-scoped tools. It does not add a production service, background job, or per-message optimizer.

Only `lib/agent/coach-style.ts` is eligible for promotion. The surrounding system prompt, tool schemas, review/save behavior, medical safeguards, ingredient evidence rules and database authorization stay fixed. The evaluation runner substitutes the candidate inside the first system message; no HTTP endpoint accepts a prompt override. Generated text is never executed as code.

## Run

From the repository root, with dependencies installed and the disposable database migrated:

```sh
uv venv /tmp/lift-gepa-venv
uv pip install --python /tmp/lift-gepa-venv/bin/python -r scripts/gepa/requirements.txt
npx tsc --noEmit -p scripts/gepa/tsconfig.json
/tmp/lift-gepa-venv/bin/python scripts/gepa/optimize.py --run-dir /tmp/lift-gepa-unique-run
```

Prerequisites:

- `.env.local` or the environment supplies `TEST_DATABASE_URL`, whose database name must end in `_test`. `DATABASE_URL` is overwritten **before** importing the server/database code. Never point this at a production database.
- `OPENROUTER_API_KEY`, or the existing local key file `~/.config/lift-journal/openrouter.key`. Keys and configuration are never written to evaluation output.
- The fixed task/reflection/judge model is `google/gemini-3.8-flash`, matching the production model at the pilot date. Requests retain `data_collection: deny`, `zdr: true` and `require_parameters: true`. The zero-retention Vertex route does not support a temperature parameter, so the judge does not set one.
- Use a **new** `/tmp/lift-gepa-*` directory. Output directories are private, outside the public repository; external tracking integrations are disabled. Do not put traces in `artifacts/`.

`--pilot-only` runs judge sanity calibration and four baseline cases. When continuing after a stopped attempt, use `--prior-cost AMOUNT` to carry forward all its conservatively accounted cost. The cap is shared conceptually across attempts, not an invitation to restart repeatedly with a fresh allowance. This command does not buy credits or raise the provider key limit.

`--resume-search /tmp/lift-gepa-previous/search` accepts only your own local checkpoint with matching baseline, fixed policy, rubric, dataset and model. GEPA checkpoints contain serialized Python state: never load a downloaded or third-party checkpoint. Version 0.1.4 evaluates the seed again before restoring its saved state; those extra calls also count against the dollar cap.

## Evaluation

`cases.py` contains 32 synthetic scenarios: 12 training, eight validation, and 12 held-out cases. Related conversation turns remain in one episode. Every evaluation gets a fresh disposable user and journal; the user is deleted in `finally`. The clock is fixed to 7 September 2026, noon in Copenhagen, inside the evaluation process. The engine's normal five-round/ten-tool limits and timeout remain in use.

The runner records attempted tools, rejected calls, replies, review proposals, duration and provider usage. Required retrieval, dates, conversions, ingredient provenance, valid visuals and absence of unconfirmed writes are checked before tone scores count. Proposal confirmation text comes from application code and is excluded from the tone score. Existing database and browser tests separately cover cross-account isolation, image ownership, streaming and review/save behavior; this text pilot is not a multimodal benchmark.

A fixed model judge assesses relevance, agency, naturalness and appropriate concision on 0–4 scales, with explicit anchors and required critique. Clear and subtle positive/negative sanity examples check that it can detect pressure, extra tasks and unsupported certainty. This is **assistant-reviewed calibration, not independent human annotation**. Using the same model for task, reflection and judging can introduce shared biases; scores are exploratory, not a guarantee of better coaching.

GEPA receives only training/validation execution feedback. It is capped at 56 metric evaluations and three proposed candidates, and stops search after the accounted spend passes $1.05 to reserve budget for testing. Candidate selection is locked before the 12 held-out scenarios are evaluated twice for baseline and candidate, with shuffled order. There is no held-out feedback loop into the optimizer.

If GEPA selects the original prompt, both held-out labels refer to the same text. Those four samples per scenario measure baseline variability; they are not evidence for an optimized candidate. `samePrompt` makes that explicit and promotion stays disabled.

The promotion gate requires a selected improvement on validation, a higher held-out mean, no new held-out hard failures and no repeat worse than baseline. The prompt diff and before/after responses still require review, followed by normal regression checks and deployment. The script **never promotes or deploys** a prompt itself. If results are inconclusive or fail a gate, retain the current prompt and report the experiment.

## Cost and failure handling

The complete experiment has a $2 ceiling, including task, reflection, judge calls and carried-forward attempts. Each request reserves a conservative amount based on text bytes, protocol allowance, the highest current endpoint prices and maximum output tokens before dispatch; concurrent reservations share one process-wide ledger. The provider's returned `usage.cost` replaces a reservation on success. Missing billing information or an uncertain failure retains the full reservation and stops the run. Cost summaries can therefore exceed confirmed billed usage. `confirmedBilled` reports successful usage for the current process separately.

Requests are paced; a 429 gets at most two bounded retries. Other infrastructure failures stop the run rather than becoming prompt-quality scores. A 350-request guard and one-hour wall-clock limit apply in addition to the dollar cap. Do not increase limits to chase a favorable result.

Truncated judge/reflection responses stop the run explicitly. The first pilot exposed a too-small judge output allowance and an incomplete reflection; the final continuation used 2,400 judge output tokens. Inspect the cause and preserve prior costs before resuming an interrupted experiment.

Output includes `manifest.json`, usage/evaluation JSONL files, judge calibration, GEPA search state, selected `candidate.txt`, repeated held-out results and `comparison.json`. Keep raw traces local. Publish only the reviewed prompt and a concise report containing synthetic examples, aggregate metrics, limitations and reproducibility hashes.

## Logging and tool-use rules (workflow harness)

`optimize_workflow.py` with `workflow-runner.ts` is a second, separate experiment. It tunes the paragraphs that decide how Coach saves and corrects records, rather than its tone: which tool to use, set corrections during a workout, workout continuity, record bundles, change plus answer, and check-ins. Everything else in the prompt stays fixed: health, privacy, evidence, "one change per reply" and untrusted content. The runner finds the editable paragraphs by how they start, moves them to one place (where `log_entry`'s paragraph is), and refuses to run if the production prompt no longer matches.

```sh
uv venv /tmp/lift-gepa-venv
uv pip install --python /tmp/lift-gepa-venv/bin/python -r scripts/gepa/requirements.txt
/tmp/lift-gepa-venv/bin/python -u scripts/gepa/optimize_workflow.py --run-dir /tmp/lift-gepa-workflow-1 --baseline-only
/tmp/lift-gepa-venv/bin/python -u scripts/gepa/optimize_workflow.py --run-dir /tmp/lift-gepa-workflow-2 --max-usd 10
```

- **Conversations:** the Jev workflow benchmark's 12 scripted scenarios (`scripts/jev/workflow-fixtures.ts`) in English and Danish, plus three held-out single-fact reports (bodyweight, sleep, a walk). They are split by scenario, never by language: 5 train, 4 validation, 6 held-out. Every conversation gets a fresh synthetic account in the `_test` database, deleted afterwards, with the clock fixed to the benchmark date.
- **Model:** Coach runs on `openai/gpt-5.6-luna`, the tier most turns use, with production prompt caching; Terra and Astra aren't covered. GEPA's reflection uses `openai/gpt-5.6-terra`. All requests keep zero retention and no data collection.
- **Score:**
  - A turn scores 0 if the saved journal fails the benchmark's deterministic checks, or if Jev flags a missed request or a wrong change at ≥ 0.85.
  - Otherwise it scores 1, minus 0.1 for each model round beyond the first (minimum 0.5).
  - Correctness therefore comes first, then fewer rounds.
  - Candidates longer than 1.25× the current rules score 0.
- **Selection:** GEPA sees feedback from train only and selects on validation. Held-out conversations run after the choice is locked, twice each, for the current rules and the candidate, in shuffled order.
- **Budget:** `--max-usd` is a hard cap of at most $10, counted from OpenRouter's reported cost (a missing cost counts as $0.05). The search stops at 65% of the cap to leave room for the held-out runs. Jev's flags have their own $0.50 cap.
- **Promotion:** `comparison.json` marks a candidate eligible for review only if it differs from the current rules, passes at least as many held-out conversations and scores a higher mean. Like the style experiment, nothing is promoted automatically. A candidate becomes a normal prompt PR: reviewed diff, updated hash note, full tests.

To measure a prompt or engine change without a search, score the current rules on every scenario, several times, before and after the change:

```sh
/tmp/lift-gepa-venv/bin/python -u scripts/gepa/optimize_workflow.py --run-dir /tmp/lift-gepa-measure-1 --baseline-only --include-heldout --repeats 2 --max-usd 2
```

Jev's evidence includes the day's drinks and water total as well as the benchmark's journal facts, which predate drink logging. Without them, Jev flags a correct water correction as a missed or wrong change.

Run directories must be new `lift-gepa-*` directories outside the repository. They hold synthetic transcripts only.

## A tool description (hard benchmark)

`optimize_bench.py` with `bench-runner.ts` tunes one tool's description (`--tool`, default `log_entry`), scored on the hard Coach benchmark (`scripts/coach-bench`) with its train, validation and held-out splits. Scoring is the same as for the logging rules: pass or fail on the journal, then fewer rounds. The first run kept the current description; see [the report](../../docs/coach-hard-benchmark-2026-09-27.md).

## Sources

- [GEPA project and pinned package source](https://github.com/gepa-ai/gepa)
- [Optimization API](https://gepa-ai.github.io/gepa/api/optimize_anything/optimize_anything/)
- [Adapter guide](https://gepa-ai.github.io/gepa/guides/adapters/)
- [Cost accounting caveats](https://gepa-ai.github.io/gepa/guides/cost-tracking/)
- [Original assessment](../../docs/gepa-coach-assessment.md)
- [Measured first experiment](../../docs/gepa-coach-experiment-2026-09-07.md)
