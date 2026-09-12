# Coach, design, photos and ingredient tags — Railway release

Published on 7 September 2026 after the owner explicitly requested release of all pending local application work.

- Website: https://lift-journal-production.up.railway.app/#coach
- Application source: `5c4691338009af0b342199957aa2a3f0160bb56a` on `codex/agent-first-journal`.
- Railway deployment: `62c1ace7-d132-4b61-bb5d-d0ff6951840c`, **SUCCESS**, created `2026-09-07T05:23:23.122Z`.
- Exact-source Linux CI: [push 34086057043](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34086057043) and [PR 34086060410](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34086060410), both successful before deployment.

The release includes the refreshed mobile/desktop navigation and visual design, Phosphor icons, optional Coach suggestions with saved preferences and recent conversation context, private photo galleries and inspection, the shared enlarged photo viewer, and stronger ingredient tagging with editable evidence. The GEPA and Restate assessments are documentation; neither system is enabled.

## Verified

- Local type checking, lint, production build and dependency audit passed. No production dependency vulnerabilities were reported. All 23 progression tests, 68 domain/database/authentication tests and 120 browser tests passed.
- Railway built the production Docker image and passed `/api/ready`. The existing one-replica European deployment, pre-deploy command and service configuration were preserved.
- Live health/readiness return 200. Anonymous session data has no user, enables Google, disables password login and denies invitation management. Anonymous private journal, Coach, image and native APIs reject access; private responses are no-store. Public user/admin/configuration-file probes return 404 and no cross-origin access grant is returned.
- The live site serves the new design styles and service-worker cache `lift-cloud-aQytU2JmPPqudTGuXODtr`. All 54 listed offline/static assets were available. Authentication and API responses remain excluded from the offline cache.
- Nine checks against the hosted bundle passed across Chromium, WebKit and Firefox: navigation, Coach galleries and large image viewing. All account APIs were intercepted with synthetic fixtures; no production account or health records were used. These checks exercise the deployed UI, not a real Google account round trip or a physical iPhone.
- An anonymous malformed-JSON Google callback returns an empty 303 redirect to `/?signin=failed`, with no download header. Form-encoded callback POSTs correctly use the authentication library's 302 handoff to its GET callback; those are a different probe from malformed JSON.

The deployed source was an exact Git archive of the application commit. Local credentials, environment files, private artifacts and dependencies were excluded. No SQL migration, historical ingredient backfill, production data import, backup/restore or infrastructure change was introduced.

## Loading the update

Open the website again. An existing Safari tab may offer **Reload update**. If it still shows the previous interface, preserve any typed draft and confirm sync, then use **Settings → Refresh app**. Do not clear website data to obtain this release.

This record and related publication-status corrections are documentation after the application deployment; the running application source is the commit identified above.
