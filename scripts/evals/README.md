# Coach evals

End-to-end tests of whole Coach conversations against the real models: the voice coach through the Gemini Live API, typed Coach through the production engine and OpenRouter. Each scenario runs on a fresh synthetic account in the local test database, then its saved journal, the coach's actions and the conversation are graded.

```sh
npm run eval -- --live                    # every voice scenario, 3 trials each
npm run eval -- --live --only voice-english,voice-drinks --k 5
npm run eval -- --live --text             # also typed Coach (spends OpenRouter budget)
npm run eval -- --live --no-judge         # code checks only
```

Requires a local `TEST_DATABASE_URL` ending in `_test` (migrated) and `GEMINI_API_KEY`. `--live` is required because every run calls paid models. Typed Coach scenarios use the same OpenRouter key as production and refuse to run with less than $1 of the monthly allowance left. Reports and full transcripts go to `artifacts/evals/`. The command exits non-zero if any regression scenario fails a trial.

## How it grades

The design follows current practice for evaluating tool-using agents:

- **Outcome first.** Like τ-bench, the main checks read the journal after the conversation, not the wording or the exact tool sequence, because different correct paths reach the same state. (Yao et al., [τ-bench](https://arxiv.org/abs/2406.12045); Barres et al., [τ²-bench](https://arxiv.org/abs/2506.07982).)
- **Procedure where it matters.** Some failures only show in how the coach got there: saving before numbers were clarified, clearing an old workout without saying so, hanging up before the athlete finished. Procedure checks catch these "corrupt successes" that an outcome check alone would pass ([procedure-aware evaluation](https://arxiv.org/abs/2603.03116)).
- **Three kinds of grader.** Code checks for records and actions; a model judge (`gemini-3.8-flash`, yes/no questions with a stated reason) for conversational qualities like language and acknowledging logged records; and people reading transcripts to calibrate both. Anthropic's guidance is to prefer outcome checks and not to trust scores without reading transcripts ([Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- **Reliability, not luck.** Each scenario runs `k` times (default 3). `pass^k` means every trial passed, τ-bench's measure of consistency; the pass rate is reported beside it.
- **Scripted regressions, simulated coverage.** Regression scenarios use scripted athlete turns taken from real failures, so they are repeatable. A few capability scenarios use a simulated athlete with a goal; simulated users are known to differ from real ones ([Lost in Simulation](https://arxiv.org/abs/2601.17087)), so their results guide rather than gate.
- **Voice specifics.** Voice failures are mostly multi-turn, so each voice scenario is a whole conversation. The simulated athlete pauses briefly after the coach stops, like a person on a call, and never talks while a check or save is running. Time from the athlete's turn to the coach's first audio is recorded ([EVA-Bench](https://arxiv.org/abs/2605.13841)).

## Scenarios

`regression` scenarios reproduce failures seen in real use on 26 September 2026 and must pass every trial. `capability` scenarios describe behaviour the coach should reach; a failure there is information, not a broken build.

Add a scenario in `scenarios.ts`: a seed for the journal, scripted athlete turns (or a simulated goal), code checks and optional judge questions. Prefer a code check whenever the answer is in the journal or the action list.

## Limits

- Voice runs use text in place of speech. They test the conversation, instructions and tools, not speech recognition or turn-taking with real audio.
- The judge is from the same model family as the voice coach, which can bias it; read the transcript of any judged failure (or pass you doubt).
- Costs are per run: roughly a few cents per voice trial on the Gemini prepaid credit. Typed Coach trials cost more and share the production allowance.
