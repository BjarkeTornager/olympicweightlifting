# Sleep logging release — 6 September 2026

Sleep logging from messages and screenshots is live at https://lift-journal-production.up.railway.app/#coach/sleep. Railway deployment `377a5fca-af6f-4c26-926a-251588f36d69` is `SUCCESS`, created at 14:10 UTC (16:10 Copenhagen). Source: `9d4647f0edc32cc8a79306a2ea1256219379cfa2` on `codex/agent-first-journal`.

The tested commit was uploaded as an exact Git archive, excluding private artifacts, environment files and credentials. Existing Railway configuration and provider settings were preserved. This release uses the existing daily check-in schema and introduces no database migration.

## Verification

- [Linux production checks](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34038044498) passed installation, migrations, type checking, lint, dependency audit, production build and the complete browser suite. The corresponding pull-request run also passed.
- Local verification passed 23 progression checks, 33 domain/database/provider tests and 51 browser workflows: 107 total. New browser workflows cover both text and screenshot sleep requests, review before save, minute-precision display, preserving other measurements, editing water after a minute-precision sleep save, reload, phone widths and accessibility in Chromium, WebKit and Firefox. Mobile WebKit output was visually inspected.
- The real configured OpenRouter/Gemini model passed the synthetic `scripts/sleep-smoke.ts` integration: a first-person hours/minutes report, the athlete's local last-night date, reviewed save, idempotent retry, screenshot time asleep rather than time in bed or weekly average, screenshot date rather than upload date, a same-date correction and clarification when only an undated weekly average was visible. Other daily measurements and notes were preserved; no food entries were created. All fixtures used a disposable test account and database, with cleanup.
- Railway build and readiness gates passed. Startup logs confirmed migrations/catalogue seeds completed and the app became ready. Live health/readiness endpoints returned 200. Unauthenticated journal, agent and image requests returned 401; private API responses remained uncached, and unauthenticated image mutations were rejected before processing.
- Service worker cache: `lift-cloud-lyihTF5ZxJzYetXTI70e5`, served with `no-cache, no-store, must-revalidate`. API routes remain excluded from its cache.
- A separate signed-in browser tab verified the Health page's **Log sleep with Coach** action, its populated sleep request, the composer **Log sleep** shortcut and **Ready to help** status. The account reported **All changes synced**. No assistant message was submitted and no test sleep data was saved in production. Existing tabs were not refreshed. Physical iPhone behavior was not directly tested; local coverage includes WebKit and mobile widths.

## Access and recovery

Tell Coach “I slept 7 hours 47 minutes last night,” or attach a sleep screenshot and ask it to log the night. Sleep images also offer **Log sleep with Coach**. Review the date and time asleep, then use **Save this change**. Corrections update the same daily record and retain unspecified values. See the [health guide](health-coach.md) for date rules, precision and screenshot limitations.

A fresh encrypted pre-release backup was saved privately as `railway-2026-09-06T14-03-13.825Z.pgdump.enc`; the archive and key remain outside Git. If Safari still shows the previous interface, save any typed input and confirm sync before **Reload update** or **Settings → Refresh app**. Existing private-pilot infrastructure limitations remain recorded in the operations runbook.
