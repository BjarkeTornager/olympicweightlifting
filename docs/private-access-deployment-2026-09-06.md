# Private access release — 6 September 2026

The privacy fixes are live at https://lift-journal-production.up.railway.app/. Railway deployment `8f3f495e-7035-4b95-8d2c-70861f7bc832` is `SUCCESS`, created at 15:52 UTC (17:52 Copenhagen). Its source is `7a5b852e556a4cb234596d8f2bc7f2dd9e01a8d6` on `codex/agent-first-journal`.

The release uses an exact Git archive of that commit, excluding local environment files, credentials and private artifacts. Railway service configuration, provider settings and stored account records are preserved. There is no new SQL migration.

## Changes

Every journal screen now requires a server-verified session. Cached identities, expired sessions and cold offline starts cannot unlock private views. Account switching mounts a separate journal, confirmed device copies are cleared on sign-out, and unsynced edits remain for recovery by the owner. Journal requests require the matching account header. An additional owner predicate protects proposal-related conversation updates.

The public Railway catalogue no longer includes legacy personal profile/PR defaults, coaching names, personal targets or starting weights. Generic programme/exercise templates remain public; new accounts choose their own loads, and existing saved workout prescriptions remain intact. The original single-athlete app keeps its legacy catalogue for migration/export.

## Verification

- Local and Linux CI checks pass: 23 progression tests, 35 domain/database/auth/provider tests and 69 browser workflows in Chromium, WebKit and Firefox. Type checking, lint, production build and dependency audit pass; the audit reports zero vulnerabilities. Both [push CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34043348266) and [PR CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34043351305) passed for the deployed source.
- Two real synthetic Better Auth accounts in disposable PostgreSQL verify journal/profile, image, conversation, proposal and session isolation, including forged ownership inputs. Browser tests verify cached-identity forgery, no private-content flash, account switching, revocation, browser back, sign-out, expiry and safe reconnection. The legacy browser regression also passes.
- Railway completed migrations/catalogue seeding and startup. Live health/readiness return 200. Anonymous journal, chat, image catalogues, image bytes/metadata and image mutations return 401 with `private, no-store`. Anonymous session checks return no user; session listing requires sign-in and user listing is absent. The file/path audit found no exposed environment, Git, migration or artifact files and no public profile/admin/user pages. CORS does not allow the untrusted audit origin; HTTPS responses include HSTS.
- Eight private deep links were checked in each of three clean browsers against the deployed site: Coach, settings, food, images, health, workout, history and progress. All 24 navigations stayed on the public landing/sign-in page, mounted no private journal and made no private-data API requests. Google sign-in is enabled and production password sign-in is disabled.
- Local production assets contained none of the four checked local secret values or legacy personal-default patterns, and no browser source maps. The deployed JavaScript and public offline shell were checked separately for legacy personal defaults and private-source exposure. The deployed service worker is `lift-cloud-fnrb_Qv4-R-l5aIh5Qs0Z`; its endpoint is not cached and its shell excludes account APIs.

## Backup and limits

Encrypted pre-release backup: `railway-2026-09-06T15-25-57.734Z.pgdump.enc`, stored privately outside Git. Existing backups and operational limitations remain in the operations runbook.

The operator's Mac was locked during final verification, so this release did not repeat the live signed-in UI check in the existing user browser. Authenticated behavior and account isolation passed the automated browser/database suites; clean-browser and anonymous API checks were repeated against Railway.

Online session verification is now required to open the journal. IndexedDB is not encrypted by the application, and disconnected old app versions or exported copies cannot be erased remotely. Existing tabs must load the update. These checks cover the tested website/account boundaries and do not establish that no historical exposure occurred. See [private access boundaries](private-access.md) for scope and device-storage behavior.
