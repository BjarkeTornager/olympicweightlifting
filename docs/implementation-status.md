# Implementation status — 5 September 2026

The new private-pilot application is implemented on `codex/railway-next-app`. This is a reviewable migration alongside the existing static website. No live athlete data has been imported, no Railway resource has been created, and the GitHub Pages deployment has not been replaced.

## Implemented

- Modern responsive interface covering Home, programme selection/details, active workouts, history editing, progress, technique library and settings.
- Pinned Next.js 16.3.4, React 19.2.8, Tailwind 4.3.3 and strict TypeScript; Radix-based accessible components with a custom design.
- Better Auth sessions, Google OAuth configuration, pilot allowlist, server ownership checks and stale-account-tab protection.
- PostgreSQL 18 schema, two migrations, exact numeric weights, composite ownership constraints, transactional journal saves and seeded programme/exercise catalogue.
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
- The local password login is a development/test aid and is disabled in production. Actual hosted Google OAuth requires credentials and a configured callback.
- Sign-out hides the account but retains its authorized offline copy on that device. Pilot account deletion is an operator procedure; self-service deletion and public registration remain outside this release.

## Verification and remaining launch gates

Local checks exercise the unchanged 23 progression cases, new domain/import cases and actual PostgreSQL authentication, ownership, retries, simultaneous writes and exact-load persistence. The browser suite covers all main layouts, log/reload/edit, import, real-server-offline reload, two-device sync with deterministic transport fixtures, and automated WCAG A/AA checks. The transport fixtures are separate from real database/session integration tests; they do not establish hosted OAuth success.

A PostgreSQL 18 logical backup was restored into a new disposable local database. The check confirmed both schema migrations, the journal revision, notes and an exact 47.5 kg value. That validates the local logical-restore path; it does not validate Railway PITR, external backup retention or the proposed production RPO/RTO.

Before the pilot is live:

1. Sign in to Railway, choose the project/region, provision isolated staging and production databases, and configure the runtime/migration roles and secrets.
2. Configure Google OAuth, allowed pilot email(s) and the public HTTPS hostname; verify real sign-in and cross-device persistence on the hosted app.
3. Enable and monitor scheduled backups/PITR, configure an independent encrypted backup, rehearse restore and rollback in Railway, and connect uptime/error alerts.
4. Test installation, offline cold start, software updates and keyboard behavior on a physical iPhone; measure performance with realistic training history.
5. Review/import the actual athlete backup, compare records and progression, then choose the production cutover time. Keep the original website available for export.

Railway CLI authentication is currently the immediate deployment blocker. This repository must not be described as a launched production service until these gates have been completed.

Latest local verification: **31 domain/database tests and 18 browser checks pass** (6 scenarios in Chromium, Firefox and WebKit). Type checking, ESLint, production build and the production dependency audit pass. The Linux Docker image built successfully; its bundled migration command completed against local PostgreSQL, and the non-root runtime returned health/readiness 200, unauthenticated journal 401 and private/no-store API headers. No `.env.local` was embedded in that image. These are local results; hosted verification remains pending.
