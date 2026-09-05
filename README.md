# Lift Journal

An Olympic weightlifting journal with a Next.js/React interface, PostgreSQL persistence, personal accounts and offline workout logging. The new application lives alongside the original GitHub Pages PWA while the Railway pilot is prepared.

**Status:** implementation is available on `codex/railway-next-app`. Railway hosting, Google OAuth credentials, backup scheduling and the production cutover still need account configuration. The existing GitHub Pages URL continues to run the original app.

## Run the new app

Use Node 22 and Docker. Copy `.env.example` to `.env.local`, set a local database password in both database variables, generate a random authentication secret, and enter your email in `ALLOWED_EMAILS`. Never commit this file.

```sh
npm ci
docker compose --env-file .env.local up -d
npm run db:migrate
npm run dev
```

Open <http://127.0.0.1:3000>. Guest logging, programmes and backups work without OAuth. For local account testing, set `LOCAL_PASSWORD_AUTH=true` and use disposable test passwords. This login method is disabled in production. Use Google OAuth for the hosted pilot.

```sh
npm run check:production
npm run build
npm run start
npx playwright install chromium firefox webkit
npm run test:browser
```

`npm start` runs the built standalone production server; it needs a completed build. Browser tests start their own production server on port 34173. The real database integration test runs only when `TEST_DATABASE_URL` points to a separate, migrated disposable database. CI provides PostgreSQL automatically.

## Included

- Responsive Home, Train, History, Progress, Exercises and Settings screens.
- All five existing programmes and 23 exercise guides; programme previews remain available during a workout.
- Exact manual loads, made/miss logging, recovery adjustments, prescription snapshots, history editing and PR prompts.
- Google sign-in through Better Auth with a private-pilot email allowlist.
- PostgreSQL transactions, account ownership, runtime validation, duplicate-save protection and explicit conflict recovery.
- IndexedDB drafts and a persistent pending-save queue; a versioned public offline shell excludes API/auth responses.
- Previewed v1/v2 backup imports preserving existing IDs, drafts and training history.
- Railway Docker deployment, release migrations, liveness/readiness endpoints and automated verification.

The application uses pinned Next.js 16.3, React 19.2, Tailwind 4 and strict TypeScript. TypeScript 7 handles the CLI check; the TypeScript 6 compatibility package supplies the compiler API needed by Next.js and ESLint. Accessible Radix primitives and owned component styles form the interface; no external UI generation service is required.

## Architecture and operations

| Path | Purpose |
| --- | --- |
| `app/`, `components/` | Next.js routes and responsive React interface |
| `lib/domain.ts`, `js/progression.js` | Shared training rules and typed domain adapter |
| `lib/local.ts`, `lib/use-journal.ts` | Account-scoped local storage and synchronization |
| `lib/auth.ts`, `lib/server.ts` | Sessions, access checks and transactional saves |
| `lib/db/`, `drizzle/` | PostgreSQL schema and reviewed migrations |
| `scripts/build-offline.mjs` | Public shell and service-worker generation |
| `Dockerfile`, `railway.toml` | Standalone Railway build and release settings |
| `tests/` | Domain, PostgreSQL, browser, offline and accessibility checks |

Read [Railway setup and operations](docs/production-operations.md) for configuration, backups, migration and release procedures. [Implementation status](docs/implementation-status.md) records the pilot's scope and remaining launch gates. The [original plan](docs/production-readiness-plan.md) includes the larger production roadmap.

The current pilot uses one revision for each account's complete journal. PostgreSQL stores a lossless JSONB snapshot plus relational workout/set projections in the same transaction. Concurrent changes require a choice between preserved copies. This is designed for a small personal pilot; entity-level sync, coach permissions, comprehensive audit trails and public registration remain future work.

## Original GitHub Pages app

The static app in `index.html`, `styles.css` and `js/` remains available for migration and recovery. Run `npm run serve` and open <http://localhost:4173> to use it locally. `npm run check` retains its 23 progression tests. The Pages workflow still publishes the static app from `main`.

Use the original app's JSON export, then sign into the new origin and import through Settings. Website storage cannot transfer automatically between domains. Keep the original export until counts, exact loads, notes, next-session targets and the active draft have been verified. See the [legacy documentation](docs/legacy-app.md) for its original workflows and limitations.
