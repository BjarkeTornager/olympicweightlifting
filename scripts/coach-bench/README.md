# Hard Coach benchmark

Scripted conversations that exercise the difficult parts of typed Coach's tool use:
- workouts over several messages;
- correcting a set;
- editing, repeating and resizing saved meals;
- several entries in one message;
- other dates, corrections that keep the other fields, and units;
- routines;
- not saving what shouldn't be saved.

The Jev workflow benchmark (`scripts/jev`) became too easy to tell good prompts apart (60/60 after the one-call change). This one is meant to have headroom.

```sh
npm run bench:coach -- --live                        # all 26 scenarios, English and Danish
npm run bench:coach -- --live --repeats 2            # each conversation twice
npm run bench:coach -- --live --split heldout        # one split
npm run bench:coach -- --live --only soda-can,morning-bundle --languages en
npm run bench:coach -- --live --routing              # production tier routing instead of Luna
```

It needs a migrated local `TEST_DATABASE_URL` ending in `_test` and the OpenRouter key (from the environment or `~/.config/lift-journal/openrouter.key`). `--live` is required because every run calls paid models. `--max-usd` (default $2, at most $10) stops before a model call once reached. A full run of 52 conversations costs about $0.15 on Luna with prompt caching. Results go to `--out`, by default a new folder in the system temp directory, never the repository: `results.jsonl`, `summary.json` and `report.md`.

## How it works

- **Scenarios:** `scenarios.ts` holds 26 scenarios in 8 categories, each in English and Danish. They are split by scenario into train (10), validation (8) and held-out (8), so prompt experiments can tune on one part and test on another.
- **Seeds:** a scenario can start from a seeded journal (an unfinished workout, yesterday's lunch, a saved routine), built with the app's own schemas and save functions.
- **Conversations:** each one runs on a fresh synthetic account in the test database, deleted afterwards, through the real engine (`runTurn`), tools and change guards, with direct logging on.
- **Clock:** fixed at Thursday 24 September 2026, 19:30 in Copenhagen, so "yesterday" and "last Tuesday" are deterministic. A turn can be sent at an earlier time that day (`at`).
- **Checks:** each turn is checked on the saved journal, the review cards and, for questions, the reply. It is never checked on the exact tool sequence, since different correct paths reach the same journal. Checks also fail on any change outside what the turn should touch.
- **Model:** Luna by default, the tier most turns use. `--routing` uses production routing through Jev instead.
- **Reuse:** experiments can pass a `Variant` to `runConversation` that rewrites the request (prompt, examples, tool descriptions); that needs the fixed model.

`tests/coach-bench.test.ts` runs without any model. It checks that every seed is a valid journal, that a Coach doing nothing fails every turn that should save, and that saving something unasked fails every turn that should leave the journal alone.

## Experiments

These all use the same runner, results format and cost cap. Results so far are in [the first report](../../docs/coach-hard-benchmark-2026-09-27.md).

- **Worked examples** (`examples.ts`): turns passing train conversations into a few worked examples in the prompt, then compares with the current prompt on validation and held-out scenarios.
- **Core context** (`profile.ts`): leaves out the skill paragraphs and tools, then compares with the full context on scenarios that don't need them.
- **A tool description** (`scripts/gepa/optimize_bench.py` with `bench-runner.ts`): runs GEPA on one tool's description, scored on this benchmark's splits.

```sh
node --import tsx scripts/coach-bench/examples.ts --live --from <results.jsonl with train> --repeats 3 --out <dir>
node --import tsx scripts/coach-bench/profile.ts --live --repeats 2 --out <dir>
/tmp/lift-gepa-venv/bin/python -u scripts/gepa/optimize_bench.py --run-dir /tmp/lift-gepa-tools-1 --max-usd 4
```

## Adding a scenario

Base new scenarios on real failures where possible; the per-turn metrics (`npm run coach:metrics`) show which kinds of turn need many rounds or fail. Prefer checks on the journal over checks on wording. When a reply must contain a number, check for the number itself. Keep a new scenario out of `train` if it will be used to judge a prompt change.
