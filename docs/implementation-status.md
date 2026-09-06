# Implementation status — 6 September 2026

The private-pilot application is live at [Lift Journal](https://lift-journal-production.up.railway.app), with the agent-first update on `codex/agent-first-journal`. Railway hosts the application and PostgreSQL in the Netherlands. Google sign-in, a stored account/session and an exact fractional workout save have been verified against the hosted database. The exact 5 September Gym Accessories workout was imported from the supplied screenshots and verified: five exercises and sixteen sets. The original GitHub Pages app remains available for export. See the [original deployment record](deployment-2026-09-06.md) and [verified assistant release](agent-deployment-2026-09-06.md).

## Implemented

- Primary Coach screen using server-side OpenRouter tools for actual training history, programme targets and site help; validated proposals, explicit review, atomic save and guarded undo. A dedicated key caps API use at $5/month; $10 prepaid credit was confirmed. Provider training and prompt logging are disabled, with ZDR required.
- Mobile rest timer, edit undo, cloud confirmation timestamp, pending-state guidance, repeat sessions, reusable/reorderable routines, weekly volume, rep records, session comparison, bodyweight labels and larger text.

- Modern responsive interface covering Home, programme selection/details, active workouts, history editing, progress, technique library and settings.
- Pinned Next.js 16.3.4, React 19.2.8, Tailwind 4.3.3 and strict TypeScript; Radix-based accessible components with a custom design.
- Better Auth sessions, Google OAuth configuration, pilot allowlist, server ownership checks and stale-account-tab protection.
- PostgreSQL 18 schema, three migrations, exact numeric weights, composite ownership constraints, transactional journal saves and seeded programme/exercise catalogue.
- Persistent IndexedDB drafts and save retries, mutation IDs, optimistic concurrency, exportable local/server conflicts and a public-only offline service worker.
- Previewed v1/v2 JSON imports, stable legacy IDs, repeated-import protection and new-account defaults without the original owner's PRs.
- Standalone Docker image and Railway deployment configuration, pre-deploy migrations, separate migration-connection support, liveness/readiness routes and CI.
- Setup, backup, restore, incident and migration procedures in [the operations runbook](production-operations.md).

## Deliberate pilot scope

The original plan describes a larger production roadmap. This implementation makes these narrower choices explicitly:

- Synchronization uses a **whole-account revision and a 5 MB snapshot limit**. A conflict preserves both copies and requires explicit selection. Entity cursors, tombstones, automatic merges and workout-level conflicts are not implemented. Account revisions stop an old snapshot from silently resurrecting deleted workouts.
- The lossless journal JSONB is the accepted state; workout/exercise/set tables are projections updated in the same transaction. Profiles, PRs and drafts remain inside the journal. There is no comprehensive immutable edit audit trail.
- Import preserves original IDs and compares canonical content. It does not maintain a separate import-batch table or translate all historical IDs into UUIDs.
- The existing tested JavaScript progression engine is shared through a typed adapter. A full TypeScript rewrite was deferred to avoid changing the training rules while replacing storage and UI. The server computes future programme plans using that same engine.
- Catalogue entries hold versioned programme/exercise documents. There is no coach programme editor, athlete assignment system or coach authorization model. Existing coach-note fields are preserved as athlete-owned data.
- One app replica is assumed. Authentication throttling is in-process; journal writes use a database-backed rate limit. High availability, distributed auth throttling and independent frontend error reporting are not configured.
- The local password login is a development/test aid and is disabled in production. Hosted Google OAuth is configured and verified, with the Google consent application in Testing and one invited pilot account.
- Normal sign-out hides the account but retains its authorized offline copy on that device. Settings also offers sign-out with device-copy removal and revocation of other cloud sessions. Pilot account deletion is an operator procedure; self-service deletion and public registration remain outside this release.

## Verification and remaining operational work

Local checks exercise the unchanged 23 progression cases, new domain/import cases and actual PostgreSQL authentication, ownership, retries, simultaneous writes and exact-load persistence. The browser suite covers all main layouts, log/reload/edit, import, real-server-offline reload, two-device sync with deterministic transport fixtures, and automated WCAG A/AA checks. The transport fixtures are separate from real database/session integration tests; they do not establish hosted OAuth success.

A PostgreSQL 18 logical backup was restored into a new disposable local database. The check confirmed both schema migrations, the journal revision, notes and an exact 47.5 kg value. That validates the local logical-restore path; it does not validate Railway PITR, external backup retention or the proposed production RPO/RTO.

Completed on Railway: private PostgreSQL 18.6, restricted runtime role and separate migration connection, real Google OAuth, HTTPS, successful pre-deploy migrations and readiness-gated deployment. A 47.5 kg workout was saved through the authenticated UI, checked directly in PostgreSQL and displayed in a second browser tab, then removed through the UI. This is hosted persistence verification; physical cross-device testing remains outstanding.

PITR is enabled, and pgBackRest reported a completed full backup with healthy repository status. An independent encrypted logical backup was also restored into a new local PostgreSQL database. Scheduled volume backup configuration was rejected as unauthorized by Railway; a daily encrypted logical-backup fallback with 30-day retention, 15-minute readiness checks and local failure notifications is installed through launchd on this Mac. An encrypted production backup was restored into a disposable PostgreSQL 18 database and its real five-exercise, sixteen-set session was verified. This fallback requires the Mac to be awake, logged in and online; always-on external alerts and independent cloud retention remain outstanding.

Before widening the pilot:

1. Provision isolated staging and rehearse Railway PITR restore and application rollback there; measure recovery time and recovery point.
2. Resolve Railway backup-schedule permissions, move the Mac backup fallback to an independent always-on service, and connect external uptime/error/backup alerts. Confirm a hosting plan beyond the current trial.
3. Test installation, offline cold start, software updates, actual device-to-device synchronization and keyboard behavior on a physical iPhone; measure performance with realistic training history.
4. Preserve the verified screenshot import; preview and compare any additional legacy backup before import. Keep the original website available for export.

The service is a live invitation-only pilot, with the operational limitations above; it is not a completed public production launch.

Latest browser verification: **24 checks pass** (8 scenarios in Chromium, Firefox and WebKit), including routines, timer reload, undo, larger text and agent review/save/undo. The real OpenRouter synthetic-account smoke test passed tool calling, exact accessory preparation, review before save, history retrieval and undo; it cost $0.006972. The expanded domain/database/authentication suite also covers agent ownership, stale requests and device revocation. Authentication checks now also cover rejected invitations, hashed passwords, incorrect-password rejection, separate device sessions, signed-out cookie replay, tampered cookies and expired sessions. A production-mode test verifies that development password sign-in/sign-up remain disabled and readiness returns 503 without Google OAuth configuration. Test users are created only in a disposable database and removed afterward.

Type checking, ESLint, production build and the production dependency audit pass. The Linux Docker image built successfully. The hosted non-root runtime returns health/readiness 200, unauthenticated journal 401 and private/no-store API headers. Production password authentication is disabled. No `.env.local` is included in the release archive or image. GitHub CI passed for the deployed assistant application commit `b58543e`; the hosted agent and read-only training summary are verified.
