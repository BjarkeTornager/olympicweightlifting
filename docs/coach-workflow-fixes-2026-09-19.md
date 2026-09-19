# Coach workflow fixes — 19 September 2026

Implemented the three changes identified by the Jev workflow benchmark and verified them against the same affected scenarios. **All 16 conversations / 24 turns now reach their prescribed outcome**, compared with **6/16 conversations and 13/24 turns** in the earlier run. These are targeted synthetic regression results, not production-quality estimates.

## Changes

- **Correct an ongoing set.** `correct_workout_set` targets an owned active workout, exercise entry and existing logged set by their exact IDs. It patches only the supplied weight, reps, result or RPE. Other sets, equal repeated sets, targets, notes and ongoing status are preserved. Unknown, ambiguous, planned and future-set targets are rejected. Current-workout reads now expose set IDs, and the engine requires a read before correction. The existing atomic save, revision, replay and Undo mechanisms apply.
- **Answer questions alongside a save.** Change tools accept a bounded optional `answer` for the additional question. The engine returns it alongside its own save/review receipt and persists both in the same completed turn. This works for direct saves and explicit previews, without another model round. Incidental model prose is still not used to establish save status; the transaction and final receipt remain authoritative.
- **Avoid unnecessary review for ordinary corrections.** Direct-logging clients use `log_entry` for requested corrections, including Danish running corrections. A logging action sent to `prepare_change` must include `reviewRequested:true` for an explicit user request to preview/review or not save yet; otherwise the tool returns a correction instruction without writing. Reviewed-only clients retain their existing behavior. Deletions, targets, plans and memories still require review.

The Coach policy and tool descriptions explain the new behavior, including the distinction between correcting a set and appending another. The deliberately pinned policy hash was updated after reviewing the change and running the new evaluation.

## Live verification

Same four scenario families, two languages, two runs each; fresh synthetic accounts in the local test database; current application engine with `openai/gpt-5.6-luna` through the existing OpenRouter privacy configuration.

| Scenario | Earlier complete conversations | After implementation |
| --- | --- | --- |
| Correct a set in an ongoing workout | 0/4 | **4/4** |
| Correct running distance, preserving time and heart rate | 2/4 | **4/4** |
| Save sleep and answer the lifting question | 0/4 | **4/4** |
| Preview sleep without saving | 4/4 | **4/4** |
| **Total** | **6/16** | **16/16** |

All **24/24 journal checks passed**, versus 17/24 before. All four mixed-request replies now contain the additional explanation in the conversation language. All four preview requests remained unsaved. No model or workflow execution errors occurred. All 16 test accounts were deleted, and an ID-restricted database query confirmed zero remaining.

The same five-question Jev rubric and 0.85 threshold were retained. Reference labels were reviewed and frozen before inference. Jev raised **0/24 alarms at 0.85** on the repaired turns. At 0.50, it incorrectly flagged one English preview as a journal-change problem with a score of 0.53; exact agreement across all five labels was 23/24. The 40 unchanged authored controls were also repeated: 18/20 flawed controls were flagged at 0.85, with 0/20 clean controls flagged. The controls remain a separate measure and are not additional successful Coach conversations.

Jev remains an **offline evaluation tool**. There is no Jev call in the production request path, automatic repair mechanism or new production-data transfer.

## Automated verification

- **220 tests passed**, zero failures or skips, including the full database suite.
- **23 progression checks passed**, with shell/PWA validation.
- TypeScript, lint, production build and diff whitespace checks passed.
- New regression coverage includes exact-set targeting, sibling/metadata preservation, malformed patches, missing reads, account isolation, stale revisions, idempotent replay, Undo, durable extra answers, explicit previews, reviewed-only clients and invalid answer metadata.

The full-suite run initially identified the expected fixed-policy hash mismatch. After reviewing and updating that baseline, the entire suite was rerun and passed.

Coach verification cost **$0.040050208** in reported usage; Jev cost **$0.003088764** at its input-token rate, for **$0.043138972 total**. No retries or uncertain charges occurred. Jev median/p95 latency on the repaired turns was 262/330 ms, measured offline.

These results cover pre-deployment verification. No database migration or browser protocol change is needed. The real-model check repeats known scenarios and uses assistant-reviewed labels; it does not establish general coaching quality or production reliability. Broader evaluation should include unseen wording and independent review.

[Machine-readable evidence](coach-workflow-fixes-2026-09-19.results.json) includes source hashes, manifests, traces, annotations, predictions, before/after counts and cleanup verification. Raw private run: `/tmp/lift-jev-workflow-SgZUx2`. See the [original workflow benchmark](jev-workflow-benchmark-2026-09-19.md) and [rerun instructions](../scripts/jev/README.md).
