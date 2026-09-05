# Railway setup and operations

This runbook targets an invitation-only pilot with one Next.js application and one PostgreSQL 18 service in the same Railway European region. Use separate Railway environments and databases for staging and production. The repository prepares deployment; it does not claim that infrastructure or backups have been provisioned.

## 1. Configure the project

1. Sign in with `railway login`, select the intended workspace and create/link a dedicated Lift Journal project. Add PostgreSQL with persistent storage and pin its major version to 18. Select the same region for app and database.
2. Add an application service from this repository/branch. Railway uses `Dockerfile` and `railway.toml`. No database is queried during image build. Release runs `node migrate.cjs`, then the service starts `node server.js` as a non-root user.
3. Generate the Railway public HTTPS hostname. Configure Google OAuth as a web application, with that exact origin and callback `https://YOUR_HOST/api/auth/callback/google`. Keep the consent application restricted to your pilot users. Configure staging as a separate allowed callback or OAuth application.
4. Set the application variables below in Railway's secret-variable UI. Do not put secret values in Git, a PR, screenshots or chat. Redeploy after changing them.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL connection on Railway private networking; use a restricted application role after bootstrap |
| `MIGRATION_DATABASE_URL` | DDL-capable private connection used only by the pre-deploy migration process; optional locally, recommended in production |
| `BETTER_AUTH_SECRET` | Cryptographically random secret of at least 32 characters, different in each environment |
| `BETTER_AUTH_URL` | Exact public HTTPS origin, without a path |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated, explicit pilot email addresses |

Railway supplies `PORT`. Do not configure `LOCAL_PASSWORD_AUTH` or `TEST_DATABASE_URL` in production. Password login remains disabled when `NODE_ENV=production`, regardless of the local flag. Avoid exposing the database through a public TCP proxy after setup; connect administrative tools through a controlled temporary access path.

The readiness endpoint deliberately returns 503 until auth configuration and the migrated database are available. Placeholder OAuth values can exercise startup locally but cannot validate a real Google login. Complete the hosted OAuth round trip before inviting anyone.

Sources: [Railway Next.js deployment](https://docs.railway.com/guides/nextjs), [private networking](https://docs.railway.com/networking/private-networking), [PostgreSQL](https://docs.railway.com/databases/postgresql).

## 2. Separate database privileges

Bootstrap migrations using the database owner, then create a `lift_runtime` login with a unique password entered privately through your database client. Set runtime privileges while connected to the app database as the migration owner:

```sql
CREATE ROLE lift_runtime LOGIN;
-- Set its password using your database client's secure password prompt.
GRANT CONNECT ON DATABASE railway TO lift_runtime;
GRANT USAGE ON SCHEMA public TO lift_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lift_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lift_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lift_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lift_runtime;
```

Replace `railway` with the actual database name. Run default-privilege commands as the role that will create future objects. The runtime role must have no superuser, role-creation, database-creation or schema-creation privileges. Keep the owner connection in `MIGRATION_DATABASE_URL`; use the runtime role in `DATABASE_URL`. Verify the app can read/save but cannot create a table. Better Auth tables require normal DML access too. Account isolation is enforced by server-session ownership and composite database constraints, not PostgreSQL row-level security.

## 3. Verify staging

- Run migrations twice; the second run must be harmless. Migrations take an advisory lock; catalogue seeding is repeatable. Never rewrite an already-applied SQL migration.
- Verify `/api/health` returns 200 and `/api/ready` returns 200. Verify an unauthenticated `/api/journal` request returns 401 and the response has `Cache-Control: private, no-store`.
- Sign in through Google with an invited email. Confirm an uninvited account is rejected. Removing an email from `ALLOWED_EMAILS` and redeploying revokes journal API access, including existing sessions.
- Import a disposable backup, log 47.5 kg, finish once, reload and confirm it on a second signed-in browser. Test another athlete account. Test conflicting offline edits and both recovery choices using disposable data.
- On a physical iPhone, install the PWA, open it online once, then test airplane-mode cold start, number inputs with the keyboard visible, logging, app restart, reconnect and a version update. Desktop WebKit automation does not replace this.
- Measure first-use performance and local save latency with realistic history. Exercise a few thousand sessions before widening scope. The current snapshot API limits each upload to 5 MB.

## 4. Backups before importing real workouts

Enable Railway's scheduled volume backups and PostgreSQL point-in-time recovery. Check the running database major/template supports the chosen recovery setup. Record the configured retention, storage costs and responsible operator. Enabling PITR can redeploy the database; schedule it before the pilot imports real data.

Set alerts for failed backups/archive uploads, storage pressure, database availability and app readiness. Add an external HTTPS monitor for `/api/ready`; `/api/health` alone does not establish database availability. Monitor Railway restart events, memory, CPU and connection use. Auth and save logs deliberately omit tokens, notes and request payloads. Frontend error aggregation and alert-provider integration are not configured by the repository.

Keep an additional encrypted logical backup outside this Railway project's failure boundary. Use PostgreSQL 18 `pg_dump --format=custom --no-owner --no-acl`, obtaining credentials from a secret store or a protected `.pgpass` file; do not paste a password-bearing URL into shell history. Encrypt before uploading and test access to the decryption key independently. Set a retention/expiry policy for both logical and platform backups.

Rehearse restore into a **new** database service. Verify schema migrations, user and journal counts, a known exact fractional load, logged results, notes and the active draft. Point a staging app at it and exercise sign-in and sync. Record time to recover and the most recent recovered committed save. Initial engineering targets are RPO ≤5 minutes and RTO ≤4 hours; these are unverified until measured in the actual deployment. Enable recovery archiving again on a restored service.

Sources: [scheduled backups](https://docs.railway.com/volumes/backups), [point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery).

## 5. Import and cut over

Export a versioned JSON backup from each old browser/PWA before changing where you log training. The new origin cannot read the GitHub Pages origin's storage. In the new app, sign in, open Settings, select the file and review the preview. Conflicting IDs/drafts stop the merge for review. Identical imports are repeatable; the database transaction commits snapshot, projections and mutation together after sync.

Compare session and set counts, dates, fractional weights, PRs, athlete/coach notes, next-session prescriptions and any unfinished draft. Open the account on another device to verify server confirmation. Keep your original export. Choose a final time to start using the new app; keep the Pages app accessible as an export source. No automatic redirect or clearing of the old website's storage is included.

## 6. Release and recovery

CI runs type checking, lint, domain rules, real-PostgreSQL tests, a production build, three-browser workflows and automated accessibility checks. Require it on the protected branch before production deployment. Deploy staging first. Keep schema changes additive so the previous compatible application image can run against the new schema.

On an incident, preserve the database and pending client data before attempting recovery. A failed release migration must stop that release; inspect its result and apply a reviewed forward migration. Do not automatically reverse migrations or restore over the current database. Roll back to a known compatible Railway application deployment when the schema allows it. If recovery needs a database restore, pause online writes, restore into a new service, verify records, switch connections and announce the recovery point to affected users. Devices with newer pending work must resolve/export it before synchronization; the app's conflict screen preserves their local copy.

`npm run db:migrate` loads local `.env.local`; production uses Railway variables. Integration tests must only use an explicitly disposable `TEST_DATABASE_URL`. Never run test fixtures against a live database.

The pilot keeps mutation IDs indefinitely so very old retries cannot duplicate a save. Auth rate limiting is in-process and assumes one app replica; journal writes have a PostgreSQL-backed per-account limit. Add distributed auth limits, measured connection budgets and a reviewed mutation-retention strategy before scaling replicas. Budget for database maintenance and restore ownership; this single-database setup is not high availability.

## Privacy and account removal

Stored data includes account email/name, session metadata, training profile, PRs, notes and workouts. Technique media connects to YouTube only when opened. No analytics SDK is installed. Device caches retain the account's authorized offline copy; use a trusted device and export before clearing website data. Signing out hides the account from the ordinary interface but does not erase its offline record.

For this private pilot, the owner handles deletion requests: verify the requested account, offer export, remove its invitation, delete its `users` row through a parameterized administrative operation (dependent rows cascade), and explain when backups expire. Cloud deletion cannot erase offline copies on disconnected devices. Implement self-service deletion, a complete retention policy and published privacy terms before public registration. Coach access is not implemented.
