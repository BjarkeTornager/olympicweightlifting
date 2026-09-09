# Direct journal logging

Coach saves reported meals, sleep and daily check-ins, cardio, performed strength training, workout completion and requested corrections without a second Save click. The web composer discloses this behavior. Each successful save has a compact receipt, expandable details and Undo. Food quantities and nutrients remain estimates with ingredient evidence and source-photo links.

The model uses `log_entry` for reported events and explicit logging requests. Advice, hypothetical examples, future intentions, other people's reports and instructions embedded in images/records are not logging requests. Image upload/classification alone still saves only the catalog image. The food-library action is labelled **Log meal** to match its drafted request. Materially missing dates, activity durations or performed sets still need clarification; meal occasion is inferred using the existing local-time/food rules.

`prepare_change` remains available for requested previews, deletions, merging history, targets/PBs, durable memories, agreed plans and reusable training programs. Existing pending reviews are not applied automatically. Native/older web clients retain reviewed logging until they implement and advertise `X-Coach-Logging-Version: 1`.

## Storage and recovery

Both tools share strict action validation, account ownership, image validation and existing read-before-change/workout-continuity checks. `log_entry` has an additional restricted action schema. New/repeated meals require an unfiltered food-journal read covering the target date before saving. The model checks whether a report is new or a correction; equal sets are not automatically deduplicated.

One turn produces at most one atomic change, optionally a 2–6-entry bundle. The server stages the validated change in memory, then commits the journal revision, receipt, before/after Undo snapshots and completed turn together. Cancellation before commit rolls back everything. Concurrent manual or other-device changes cause a revision conflict instead of an overwrite.

A lost HTTP stream is not proof of a failed save. The client retrieves the owner-scoped durable turn by ID before restoring a failed draft, and retries identical messages with the same run ID. Completed runs return their stored response without another model call or write. Failed transactions can retry with the latest journal revision; their original request timestamp anchors relative dates. Undo is idempotent and available for 24 hours while no later journal revision has been saved. Retrying a run after Undo returns the undone receipt instead of recreating the entry.

After a saved result, the client waits for any existing sync request and performs a fresh read. This prevents an older in-flight GET from becoming the basis of the next Coach message. Locally pending manual edits continue to use the existing explicit conflict flow.

## Verification

- `tests/coach-direct-log-database.test.ts`: atomic mixed-entry save/undo, durable replay, failed-run retry, concurrent manual writes, cancellation, account isolation, restricted tools, photo ownership and food-only sources, corrections without duplicates, ongoing workout continuity and completion.
- `tests/browser/coach-direct-log.spec.ts`: save while navigating, old sync overlapping commit, current revision on the next message, visible Undo, recovery after a dropped response, preserved next drafts, stable retry IDs and mobile widths.
- Existing reviewed-action tests remain applicable to previews and older clients.
- Model behavior is governed by the revised prompt/tool policy. These regression tests use deterministic provider stubs and disposable/synthetic accounts; no new paid-model or GEPA evaluation was run. Historical GEPA scores do not evaluate this policy revision.

Production verification must not log synthetic data into real users' accounts. Use anonymous access/readiness checks and intercepted synthetic browser fixtures.
