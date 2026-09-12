# Coach training programs

Coach previously had `save_routine`, which requires an existing completed session. It could describe a new plan but could not save that prescription as a reusable routine, and had no routine editing tool. The reported seated leg curl / standing calf raise example is now a regression case.

## Supported workflow

- `create_routine` builds a reusable session from its name and ordered exercise/set list, without a session ID or date. `update_routine`, `delete_routine` and `start_routine` operate on an owned routine. The existing copy-from-history action remains available.
- `create_training_program` creates a named plan with one to 28 ordered days and an optional duration in weeks. Strength prescriptions include sets, reps/ranges, optional rest and target RPE, and notes for technique, tempo or supersets. A null starting load means choose later; zero means bodyweight. Exercises outside the catalogue use an explicit `custom:Movement name` identifier. Days can also contain planned cardio or recovery instructions.
- `update_training_program` patches top-level properties. Providing days replaces the complete ordered day list; existing day IDs must belong to the original program. The full original is read before preparing an edit, and the review includes the prior version for comparison. `delete_training_program` removes a saved program. `start_training_day` starts its strength prescription as an unfinished workout with fresh entry/set IDs and no logged results.
- Train exposes **Your routines** and **Your programs**. Program days expand to show their complete prescription. **Build with Coach** and **Edit with Coach** open an editable message without sending it automatically. Cardio plans link to Cardio & movement for recording actual activity. Programs can be deleted with confirmation and local undo.

Saving or editing a program never records performed exercise, changes personal bests, replaces an active workout, or changes completed history. Target RPE is preserved separately from measured RPE. Planned cardio never becomes completed cardio. Starting a strength day retains program/day instructions; if unusually long activity notes exceed the workout note limit, the workout includes activity summaries and points to the complete saved program instructions.

## Tool reliability and privacy

`training_library` lists/searches owned routine and program summaries, with pagination, and retrieves one complete record by ID. Editing, deleting or starting requires that full read during the current turn. Starting additionally requires reading the active workout. All actions pass strict server validation and the existing proposal approval, owner, revision, expiry, idempotency and undo checks. No new public data endpoint is added.

A real Luna evaluation exposed another failure: designing four days caused twelve separate exercise lookups, exceeding the previous provider envelope limit. `exercises` now accepts a batch of up to 30 queries and returns deduplicated compact planning information, including exact IDs, load conventions and video links. The provider accepts at most 32 proposed tool calls so the engine can return corrective feedback for an oversized batch. **The execution budget remains ten tools and five model rounds.** An oversized batch executes nothing, pairs every call ID with an error result, and lets Coach retry with one batch lookup. Streaming and non-streaming adapters enforce the same bounded envelope. Tool validation errors identify fields that Coach can correct without asking the athlete to fix its formatting.

The app owns tool execution and validates proposed changes, consistent with the [function-calling integration guidance](https://developers.openai.com/api/docs/guides/function-calling). GPT-5.6 Luna, OpenRouter privacy filters and the existing conversational style remain in use. The fixed feature policy was deliberately updated, reviewed and evaluated; this is not a GEPA style promotion.

## Storage and compatibility

Programs use the existing `program.customPrograms` collection; older clients already retain this array as opaque JSON. New `training-program` records are validated while legacy opaque records are retained. The journal rejects duplicate program/routine IDs and invalid new program records. Backup imports merge independent programs and refuse conflicting versions, including when the journal has no completed sessions. No database migration or conversion of personal records is needed.

`X-Training-Programs-Version: 1` identifies clients that can display the new review. Cached Coach clients must refresh before submitting or approving a change they cannot fully render. Account authorization still happens before the version check. Routine editors allow unknown starting weights to remain blank.

## Validation

The production checks cover 23 progression tests and 88 domain/database/authentication/protocol tests. New checks cover creation without history, full routine edits, program patches and day ordering, custom exercises, null loads, planned cardio, original-state preservation, backup conflicts, cross-account reads and approval attempts, stale saves, retry, undo, malformed tool recovery, batch deduplication and bounded streaming envelopes.

Five new browser scenarios run in Chromium, WebKit and Firefox (15 checks): routine review/save/start/reload, editing an unknown load, program before/after review and undo, responsive strength/cardio/recovery day views, and deletion while retaining the active workout. Accessibility and horizontal layout are checked from 320 to 1440 px; phone screenshots are visually reviewed.

The real-provider evaluation uses only synthetic disposable test accounts. It exercises the reported routine, a correction, a mixed three-day plan, program edits, starting a day, preserving active training, and undo. A separate four-day design scenario verifies Coach chooses the exercises and prescriptions from goals/equipment rather than demanding a complete plan from the person. That scenario runs through both ordinary and production streaming responses. Diagnostic and final costs are tracked under a $0.50 cap; final figures and deployment verification are recorded in the PR.

Reproduce with `TRAINING_PROGRAM_SMOKE=true`, `AGENT_PROVIDER=openrouter`, `AGENT_MODEL=openai/gpt-5.6-luna`, and a disposable `TEST_DATABASE_URL` ending in `_test`, then run `node --import tsx scripts/training-program-smoke.ts`. Set `TRAINING_PROGRAM_SMOKE_CASE=design` for just the design scenario and `TRAINING_PROGRAM_SMOKE_STREAM=true` for streaming. The script requires explicit opt-in and removes its synthetic account in `finally`.
