# Targets release, October 2026: deploy, compatibility and rollback

The core lane of the targets evidence review (`docs/targets-evidence-review-2026-10-04.md`, section 5) ships as one release from `targets/one-target`: PR 4 (maintenance), PR 5 (macros), PR 6 (pregnancy, breastfeeding and kidney inputs), PR 13 (goal setup) and PR 7 (one weight, one target). This note says what changes at the release, what an older server does with the new data, and when a rollback is still safe.

## What changes at the release

- Saved daily targets never change by themselves. The plan, worked out again at the current weight with the higher maintenance, suggests new targets on Today (website and the new iPhone build); they change only when the athlete takes them. Most athletes with goals see a suggestion on release day, as maintenance rose by about 200 to 450 kcal a day.
- The release check that runs on every migrate (`scripts/migrate.ts`, `regateSavedGoalTargets` in `lib/legacy-goal-targets.ts`) leaves every target the plan of 4 October saved, including a deficit or floor broken by less than the calories' 10 kcal rounding, and every target recorded since. Every release since 4 October has already run it, so the deploy log should read `Goal targets brought within the plan's limits: 0.` Anything else is worth a look before the TestFlight upload.
- A suggestion that sets a deficit without answers to the low-energy questions asks them on Today. Coach's own opening for those questions waits while Today asks them, and for about 3 months after a suggestion is taken or kept over without answers. An answer given when keeping one is saved too.
- There is no SQL migration. Everything new lives in the journal JSON.

## New stored data

On `profile` (which older servers keep as it is, since it passes unknown keys through): `targetHistory`, `declinedTargets`, `energyCheck`, `weighIn`, `goalHealth`, `heavyManualWork` and `bodyweightSetAt` (when the weight was last given in Settings).

On `health`: `bodyMass`, the Apple Health weights the new iPhone build sends, one a day. Older servers' health parser drops unknown keys, so they do not keep it (below).

`TargetsProposal.energyCheck.ifYesNotes` and `keep_current_targets.energyAnswer` are new optional fields in the native API; `npm run openapi` regenerated the schema and fixtures.

## Deploy order

1. Merge to `main`; Railway deploys after CI, which takes about 14 minutes.
2. Check the Railway deploy is live and the release check logged 0 before uploading the TestFlight build. The new build sends weights and the new target actions, which an older server refuses (below).

## An older server, while a deploy drains or after a rollback

- **Apple Health weights are deleted.** An older server reads a journal with `health.bodyMass` but drops it, and its first write to that account (any web save, Coach save, iPhone action or health sync) saves the journal without it. After rolling forward again, the iPhone sends only the last 2 to 14 days, so older weights are gone for good.
- **The new iPhone build's choices on a suggestion are refused.** `take_suggested_targets` and `keep_current_targets` get a 400, and the Outbox drops them as refused; the card comes back once the new server is live. Its health sync gets a 400 for days with weights and resends them without, so sleep, workouts and the rest still arrive.
- **Goals saved on the older server stop suggestions.** They save the older plan's targets (lower maintenance) without a record, so the new server treats them as the athlete's own: it suggests new ones only at the goal or its date, until the goals are saved again on the new server.
- **Voice.** The website's voice coach sends `X-Voice-Client: 5`, which an older server accepts; it saves goals at once, without the read-back before a deficit.
- The new `profile` fields above survive, unused, and the new server picks them up again after rolling forward.

## Rollback

Until a TestFlight build that sends weights has synced for anyone, a rollback to `f8b7e27` (Merge #104) or earlier loses nothing beyond the behaviours above. Once it has, this release is **roll-forward only**: a rollback deletes imported Apple Health weights, as described above. Fix forward instead, as for `docs/cardio.md` and `docs/food-data.md`.
