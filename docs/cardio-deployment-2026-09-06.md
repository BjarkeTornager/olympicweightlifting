# Cardio health tracking — verified Railway release

- Site: https://lift-journal-production.up.railway.app
- Cardio: https://lift-journal-production.up.railway.app/#cardio
- Railway deployment: `aaabd740-9dff-469f-a9ee-d5be3f2a2cad`, **SUCCESS**.
- Created: 6 September 2026, 18:29:24 UTC.
- Published source: `319008681b01b712cd64b0aeeed3ea56c4fb1e43`.
- Service worker: `lift-cloud-7V05cHBtQyTVcWLNjyvYS`.

## Included behavior

Train now switches between Strength and Cardio & movement. Users can add, correct, filter and delete activities, describe them to Coach, or ask Coach to log an activity screenshot. The private Activity catalog remains separate from Food. Coach prepares a review before saving and can show tables/charts of activity history.

Weekly summaries, Progress and the daily health overview include cardio alongside existing strength, nutrition and recovery records. Activity energy remains separate from food intake and never automatically changes nutrition targets. There is no Apple Health connection or background wearable tracking. See [cardio tracking](cardio.md) for supported activities and measurements.

This is an additive field in the account's existing JSONB journal; no SQL migration is needed. Old backups/device copies upgrade safely. Older clients omitting the field retain saved cardio; an explicit empty collection still permits deletion. Lost acknowledgements from the previous release remain retryable. Ownership, revision checks, duplicate-save protection, guarded undo and invitation-only Google access are retained.

## Verification

- **166 local checks passed:** 23 progression tests, 50 domain/database/auth/provider tests and 93 browser checks. Type checking, lint and the production build passed.
- Both exact-source CI runs passed: push `34051480765`, PR `34051484591`. Linux checks include fresh PostgreSQL migrations, dependency audit, build and the three-browser suite.
- New tests cover validation, time/distance arithmetic, patch preservation, backup conflicts, isolation, read-before-write guards, reviewed saves/retries/undo and older-client compatibility.
- A real OpenRouter/Gemini smoke passed exact text and screenshot measurements, automatic Activity classification, review before save, a read-only visual table and undo. It used a disposable synthetic account and removed it afterwards; no production health data was sent.
- **Nine focused browser checks passed against deployed assets**, covering manual logging/correction/filter/reload/deletion and Coach text/screenshot reviews in Chromium, WebKit and Firefox. Synthetic session/API responses prevented production writes. Responsive widths of 320–1440 px and WCAG A/AA checks passed. Phone screenshots were inspected, including Safari select controls.
- Deployed health/readiness endpoints returned 200. Anonymous session checks returned no user, Google enabled, passwords disabled and no invitation capability.
- `scripts/check-public-access.mjs` passed against production: private journal, image, conversation and invitation APIs denied anonymous access; private-file paths returned 404; private/no-store headers and origin restrictions were retained.
- Built public assets contained no owner email, owner configuration or invitation-table markers. The live service-worker version changed from the preceding release.

Encrypted pre-release backup: `railway-2026-09-06T18-18-56.417Z.pgdump.enc`, 1,018,485 bytes, using the existing private backup store and key. Deployment used a clean archive of the tested commit, excluding untracked artifacts, local environment files, database archives and credentials.

These checks use isolated browsers and synthetic records; they do not represent a physical iPhone or a real Google account sign-in test. See [private access boundaries](private-access.md) and [operations](production-operations.md) for limitations.
