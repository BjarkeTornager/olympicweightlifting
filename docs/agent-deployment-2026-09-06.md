# Hosted assistant release — 6 September 2026

Lift Journal is live at https://lift-journal-production.up.railway.app/#coach. Application source is commit `b58543e07153d273dd4052d0e2e9dc103521f71f` on `codex/agent-first-journal`, reviewed in draft PR https://github.com/BjarkeTornager/olympicweightlifting/pull/2. Railway deployment `e1d95375-316d-4ad6-8672-e070d63c2618` completed successfully. Its source upload was a Git archive, excluding local environments, private artifacts and credentials.

## Verified

- GitHub Linux run https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34024104813 passed for the deployed application commit: type checking, lint, 23 progression tests, 18 domain/database/authentication/provider tests, production dependency audit, build and 24 browser checks across Chromium, Firefox and WebKit.
- The real OpenRouter synthetic-account test passed tool calling, exact accessory preparation, review before save, history retrieval and undo. Production read-only verification retrieved every set from the real 5 September Gym Accessories session, correctly identifying accessory training.
- Production runtime role can read the new agent tables. The database still contains one session, five exercises and sixteen sets; one read-only chat turn and no proposals were present after verification. Progress displays 6,566 kg volume and the correct rep records.
- Readiness is HTTP 200 with `status: ready`; unauthenticated agent and journal reads return 401. Private API responses have `private, no-store` caching. The migration is additive; all three migrations are applied.
- The updated app and formatted conversation were visually checked at desktop and 390 × 844 viewport sizes. The offline service-worker update was activated without losing the journal. Physical iPhone keyboard, offline cold-start and cross-device checks remain outstanding.

## OpenRouter budget and credit search

The owner selected OpenRouter and added $10 themselves. The dedicated production key retains its $5 monthly usage cap, with auto top-up off. Total verification usage was $0.01212675, leaving approximately $9.99 prepaid credit. Requests require tool support, no data collection and ZDR. No account profile name/email or credentials are sent through training tools.

No verified general-purpose promotional code was found for this personal setup. OpenRouter's [startup programme terms](https://openrouter.ai/startup-program-terms) describe discretionary benefits of up to $5,000 for qualifying startups, including company website and professional company email requirements. No application was submitted and no promotional credit was claimed. Its [FAQ](https://openrouter.ai/docs/faq) says buying at least $10 in credit raises the free-model allowance to 1,000 requests/day; this is an allowance for free models, not additional paid-model credit.

## Recovery and remaining pilot work

An encrypted production backup taken after migration, `railway-2026-09-06T09-15-30.871Z.pgdump.enc`, was restored into a newly created disposable local PostgreSQL 18 database. It contained three migrations, one user, one journal, one session and sixteen sets. Only the disposable restore database was dropped. The encrypted archive and encryption key are in private operator directories outside Git.

The installed launchd job checks readiness every 15 minutes and makes daily encrypted backups with 30-day retention and local failure notifications. It requires this Mac to be awake, logged in and online. Railway PITR archive status is healthy, but its scheduled-volume-backup API rejected configuration as unauthorized. Always-on external monitoring/independent cloud retention, an isolated Railway PITR/rollback rehearsal, physical iPhone verification and confirmation of hosting beyond the Railway trial remain open. The site remains an invitation-only pilot.
