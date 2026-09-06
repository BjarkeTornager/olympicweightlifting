# Food and daily health Coach release — 6 September 2026

The redesigned Coach, Food journal and Health history are live at https://lift-journal-production.up.railway.app/#coach. Railway deployment `9149e530-5814-4fe8-bbd7-d5be301f0124` is `SUCCESS`, created at 12:49 UTC (14:49 Copenhagen). The source is `989c40448cc7738e5fe674e4b820b6ab2f841646` on `codex/agent-first-journal`.

The upload was an exact Git archive of that commit. Local environment files, private artifacts and credentials were excluded. Existing Railway service configuration and provider settings were preserved.

## Release verification

- [Linux production checks](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34034020632) passed clean installation, migrations, type checking, lint, domain/database checks, dependency audit, production build and browser workflows. The first attempt caught missing optional dependency lock entries; the release includes the repair generated with production's npm 10.
- Railway build and readiness gate passed. Deployment logs confirm `Database migrations and catalogue seeds complete.` Production now has four migrations and the new `food_photos` table.
- Read-only verification inside the running application confirmed runtime SELECT/INSERT/UPDATE/DELETE privileges on photos and the new agent attachment column. Sharp successfully encoded and decoded synthetic JPEG pixels in the production Linux container. No test records were added to the production database.
- Live `/api/health` and `/api/ready` returned HTTP 200. Unauthenticated journal, agent, photo catalog and individual-photo requests returned 401 with `private, no-store` headers.
- The new service worker uses cache `lift-cloud-KxphYNnscvplF5QpJQh3z` and is served with `no-cache, no-store, must-revalidate`. API routes remain excluded from its cache.
- Browser verification against the hosted account showed “Your day, in focus.”, Plan my day, daily check-in, the Food catalog and Health history. Activating “Reload update” retained the existing journal and conversation; the app returned to “All changes synced.” Physical iPhone behavior was not directly tested in this release; local browser checks include WebKit and phone widths.

## Recovery and access

An encrypted pre-release database backup was saved in the private operator backup directory as `railway-2026-09-06T10-39-37.743Z.pgdump.enc`. Its key and archive remain outside Git. The photo migration is additive and does not rewrite training history.

Open the same Railway address in Safari and refresh. If a version banner appears, tap **Reload update**. The existing **Settings → Refresh app** action also checks for the new version without clearing account storage. Food is at `/#food`; Health history is accessible from Coach on phones and the desktop navigation.

Existing private-pilot monitoring, backup retention, physical-device validation and infrastructure limitations remain as recorded in the operations runbook; this release does not change them.
