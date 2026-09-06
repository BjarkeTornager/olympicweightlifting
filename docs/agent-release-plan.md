# Agent-first release work

Requested scope: make the agent a primary entry point while improving phone logging, recovery, save status, templates, progress and privacy controls.

## Acceptance checks

- [x] OpenRouter is the hosted provider, with a private capped key; Ollama remains an optional development adapter.
- [x] Agent uses the signed-in account's actual training, programme catalogue and maintained app help. It can prepare validated workout/draft actions with explicit dates and sets, review, idempotent save and undo.
- [x] Agent requests never accept another account ID, arbitrary SQL, shell commands or network destinations. Provider errors preserve drafts and do not claim a save occurred.
- [x] Clear local/cloud save timestamps and pending status; undo respects newer edits.
- [ ] Rest timer survives reload/backgrounding; phone logging and finish controls remain usable with the keyboard open.
- [x] Repeat sessions, save/edit/reorder personal templates, and use them without copying completed results.
- [x] Weekly volume, repetition records and session comparison supplement the load graph.
- [x] Bodyweight formatting, larger text, sign out other devices and clear this device's account copy.
- [x] Scheduled encrypted backup, monitored readiness, recovery rehearsal and hosting plan reviewed; record any actual account/billing blockers.
- [x] Database/domain/agent tests, browser and accessibility checks, Linux build and hosted verification pass for the deployed application commit.

The existing 5 September Gym Accessories session (5 exercises, 16 sets) is now in the account. Preserve it throughout verification; use disposable test databases for writes in automated tests.

The owner approved OpenRouter for the hosted assistant on 6 September 2026. Provider requests require no training and ZDR; account profile names/emails are not included in tool results. Physical iPhone testing requires the user's device; desktop WebKit is supplementary.

## Confirmed provider choice

The owner selected OpenRouter for the hosted assistant, with a $5 monthly API usage cap. Ollama remains a development option. Real local Qwen3 30B tests exceeded the 90-second request deadline on this 32 GB Mac; do not use this Mac as the live site's model host.

## Verification

- All 24 browser checks passed across Chromium, Firefox and WebKit, including accessibility checks and the agent review/save/undo flow.
- Real OpenRouter synthetic-account test passed: exact accessory workout, review before write, history retrieval and undo. Initial verification cost $0.006972. The owner added $10; the monthly usage cap remains $5 and auto top-up is off.
- Linux CI and hosted read-only verification passed. Physical iPhone keyboard/offline checks remain outstanding. See [the release record](agent-deployment-2026-09-06.md).

The rest timer, reload persistence, responsive keyboard controls and 390 × 844 layout are implemented and checked in browser automation/visual inspection. The phone acceptance item stays open until physical-device testing.

## Operational work

- Railway PITR reports healthy archive status. Its volume scheduling API still returns UNAUTHORIZED (6 September 2026); no schedule was silently assumed.
- Installed a local launchd fallback (`com.lift-journal.operations`): readiness every 15 minutes, encrypted PostgreSQL backup daily, 30-day retention, local failure notification. It requires this Mac to be awake, logged in, online, and authorized with Railway. This is not an always-on external monitor.
- Restored encrypted production archive `railway-2026-09-06T08-42-00.643Z.pgdump.enc` into a new disposable PostgreSQL 18 database. Verified 2 migrations, 1 user, 1 journal, 1 session and 16 relational sets. Dropped only the disposable restore database.
- A hosting plan beyond Railway's trial, always-on external monitoring, and a Railway PITR restore rehearsal in isolated staging remain account/operational work.
