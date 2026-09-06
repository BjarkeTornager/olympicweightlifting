# Cardio and movement

Open **Train → Cardio & movement**, **Coach options → Cardio & movement**, or `/#cardio`. Desktop navigation also includes Cardio. It shares the private account journal with strength sessions, nutrition and health check-ins.

## Logging

**Log activity** records running, cycling, walking, swimming, rowing, hiking, elliptical and other activities. Activity type, date and duration are required; distance is optional. The form accepts hours/minutes/seconds and distances in kilometres, miles or metres. Values are stored in seconds and kilometres. More details includes a name, moving/elapsed time, average/maximum heart rate, perceived effort, elevation gain, reported activity energy and notes. Missing values remain null.

Tell Coach, for example, “I ran 5 km in 28 minutes 20 seconds today. Average heart rate was 145.” Coach checks existing entries before preparing a review. It asks for missing activity, date or duration. Press **Save to journal** to confirm; mentioning an activity alone does not bypass review. Corrections read the original activity and patch only supplied fields. Deletion also requires review. Saves use the existing account ownership, revision checks, idempotency and guarded undo.

Activity screenshots are automatically catalogued in **Activity**, with editable categories. **Log activity with Coach** attaches an activity image to a draft request. Coach uses visible measurements and dates, distinguishes moving and elapsed time, and asks about ambiguity. Uploading or discussing an image does not itself save an activity. The private image catalog and Coach conversation retain the image; the cardio record stores the reviewed measurements, without a separate image-link field.

## History and progress

The cardio screen shows seven days of logged duration, activity counts and reported distance, a duration chart and activity breakdown. History supports activity/date filters, pagination, editing and confirmed deletion. Daily Coach and Health include strength and cardio in the training picture; Progress offers a compact cardio summary. Ask Coach for activity comparisons, tables or charts through the existing AG-UI visual tools.

Pace uses the supplied duration and distance: per kilometre for running/walking/hiking, per 100 metres for swimming, per 500 metres for rowing; cycling/elliptical/other use km/h. These are arithmetic summaries of the entry, not GPS analysis. Reported activity energy stays separate from food intake and never automatically changes calorie targets. Unlogged days are unmeasured, not proof of inactivity. There is no inferred heart-rate zone, readiness score or expenditure estimate.

## Storage and verification

Cardio lives in `JournalState.cardio.sessions` in the existing account-scoped JSONB snapshot; no SQL migration is required. Old journals and device copies gain an empty cardio section. Older clients that omit the new field retain the saved cardio collection; explicitly sending an empty collection still permits deletion. Interrupted acknowledgements from the previous release can retry safely. Backup/import preserves activity IDs and rejects conflicting duplicates. Existing food, strength, check-in and conversation records remain intact.

`tests/cardio.test.ts` checks validation, timing/pace, patch preservation, proposals, summary calculations and imports. `tests/cardio-database.test.ts` verifies private reads, read-before-write guards, save/retry/undo and older-version synchronization. Browser tests cover manual entry/correction/deletion, activity filters, reloads, Coach text/screenshot reviews, responsive widths and accessibility in Chromium, WebKit and Firefox.

`scripts/cardio-smoke.ts` is an opt-in real-provider check requiring `CARDIO_SMOKE=true` and a disposable `_test` database. It creates only synthetic records, tests text and image measurements, automatic activity tagging, review before save, a read-only table and undo, then deletes its synthetic account. It must never run against production records.

This feature has no Apple Health connection, wearable synchronization or background activity tracking.
