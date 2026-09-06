# Private pilot deployment — 6 September 2026

- Application: <https://lift-journal-production.up.railway.app>
- Railway project: `olympicweightlifting`, production environment, app service `lift-journal`, database service `Postgres`.
- Region: `europe-west4-drams3a` (Netherlands), one application replica.
- Database: PostgreSQL 18.6 with persistent storage and private networking; no public database TCP proxy.
- Google OAuth: dedicated Lift Journal project, Testing audience, invited owner account only. Callback: `/api/auth/callback/google`.
- Initial application source: `6b6e2bf8a25b6e5848e388a8df0581f7deb8b2a2`; successful deployment with migration/readiness gates: `fc58768b-d693-4d9f-924d-eaf035beca19`.
- Source remains on `codex/railway-next-app`, draft PR #1. The legacy GitHub Pages site remains available, and no historical journal has been imported.

## Verified

The real Google account selection and consent flow returned to the app successfully. PostgreSQL contained one Google-linked user and an active session. A temporary workout was saved through the UI; the database stored its exact `47.5` kg load. A second browser tab displayed `47.5 kg × 1`. The temporary workout was then deleted through the UI, without changing personal records.

The deployment logs show the bundled database migrations and catalogue seeding completing before app startup. Deployment metadata confirms `/api/ready`, a 120-second readiness timeout, one European replica and three restart retries. Public health and readiness routes returned 200; unauthenticated journal access returned 401 with private/no-store headers. The session endpoint reports Google enabled and local password authentication disabled. The public privacy page returns 200.

The runtime database role has DML access and no schema-create, superuser, database-create or role-create privileges. Migration credentials are configured separately. Secrets were provisioned directly through Railway and are not in the repository. Releases use a clean source archive, excluding local environment files and untracked artifacts.

Application verification before deployment: 33 domain/database/authentication tests, 18 browser checks across Chromium/Firefox/WebKit, type checking, lint, production build and dependency audit. Hosted testing supplements these checks; a second browser tab does not establish physical cross-device behavior.

## Recovery setup and limitations

Railway PostgreSQL PITR is enabled. The actual pgBackRest repository reported status `ok` and a completed full backup `20260906-071248F`. A separate encrypted logical snapshot was saved outside Railway at `~/.local/share/lift-journal/backups/railway-2026-09-06T07-25-20-819Z.pgdump.enc`. Its metadata records a successful restore into a newly created local PostgreSQL 18 database, checking two migrations and 24 catalogue documents. This snapshot predates the first Google account and is not a current backup of later training data.

The backup uses AES-256-GCM: eight-byte ASCII `LIFTDB01`, twelve-byte IV, sixteen-byte authentication tag, then ciphertext. Its 32-byte key is kept in the owner's protected local configuration directory at `~/.config/lift-journal/backup.key`; both key and backup have owner-only permissions. Preserve the key separately from any copied backup. A snapshot on this computer does not provide an independent location if the computer is lost.

Railway rejected scheduled volume-backup configuration as unauthorized. Recurring independent backups, explicit retention, external uptime/error/backup alerts, a Railway PITR restore rehearsal, isolated staging and measured RPO/RTO remain outstanding. Hosting is currently on the account's trial allowance. These limitations must be resolved before broader or long-term production use.

Physical iPhone installation/offline/update checks, actual two-device synchronization and historical athlete-data import/comparison remain pending. The new origin cannot automatically read data stored by the old GitHub Pages app; use its export and the new app's Settings import preview.

## Future releases

`.railway/railway.ts` replaces the unsupported legacy `railway.toml` configuration for this new service. The partial definition owns only the application, preserves all existing secret values and leaves database storage/recovery resources separately managed. Review a pinned `railway config plan` before applying; no secret or storage deletion is expected. See [the operations runbook](production-operations.md) for commands and recovery procedures.

The initial deployment used explicit CLI source upload. GitHub automatic deployment and branch protection are not configured by this release.
