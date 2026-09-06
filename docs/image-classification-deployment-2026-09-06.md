# Private image categories release — 6 September 2026

Automatic tagging and the private image library are live at https://lift-journal-production.up.railway.app/#images. Railway deployment `42af7173-6530-44ec-88ce-a0ef194da8d0` is `SUCCESS`, created at 13:45 UTC (15:45 Copenhagen). The source is `bb5bf1ed12d09e673ee60d5b4c3acd9bc1ff10fc` on `codex/agent-first-journal`.

The release used an exact Git archive of the tested commit. Local environment files, private artifacts and credentials were excluded. Existing Railway configuration and assistant provider settings were preserved.

## Release verification

- [Linux production checks](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34036815083) passed clean installation, migrations, type checking, lint, dependency audit, production build and browser workflows. The pull-request run also passed. Local verification covered 23 progression checks, 32 domain/database/provider tests and 45 browser workflows (100 checks total). The final mobile layout adjustment passed a fresh build and the six image workflows across Chromium, WebKit and Firefox before the same commit passed Linux CI.
- The real configured OpenRouter/Gemini model correctly classified four synthetic fixtures: Apple Health sleep, a food nutrition label, an Apple Fitness activity summary with burned calories, and an unrelated receipt. Misleading upload labels were excluded from inference. Only the nutrition image appeared in Food; tagging created no journal entries. This ran against a disposable test account and database, with cleanup, not against production records.
- Railway build and readiness gates passed. Startup logs confirmed `Database migrations and catalogue seeds complete.` Production now has five migrations. Read-only checks confirmed all three new image columns, the account/category index and runtime SELECT/INSERT/UPDATE/DELETE privileges.
- The production meal-reference invariant passed: no meal points to a missing or non-food image. Existing meal-linked images retained Food; other archived uploads remain in Needs review without being transmitted to the provider.
- Live `/api/health` and `/api/ready` returned HTTP 200. Unauthenticated journal, agent, legacy food catalog, generic image catalog, image bytes and metadata requests returned 401 with `private, no-store`. Unauthenticated image upload, category edit and classification requests also returned 401 before writes or inference.
- The new service worker uses cache `lift-cloud-97mJLKNuXfhZzuCKOL7yY`, served with `no-cache, no-store, must-revalidate`. API routes remain excluded from its cache.
- A new signed-in browser tab confirmed the six categories, automatic tagging control, review/correction controls, catalog export, separate Food and Health collections, and the **Images & screenshots** entry point near the top of Coach. Existing journal and conversation entries remained visible, and the app reported **All changes synced**. No production images were uploaded, retagged or edited during verification. Automatic approval review rejected refreshing the pre-existing tab due to possible unsaved input; verification continued in the separate tab without refreshing the original. Physical iPhone behavior was not directly tested; local browser coverage includes WebKit and phone widths.

## Recovery and access

A fresh encrypted pre-release database backup was saved in the private operator backup directory as `railway-2026-09-06T13-39-22.172Z.pgdump.enc`. The archive and key remain outside Git. Migration `0004_last_professor_monster` adds metadata in place and preserves stored image bytes and explicit meal links.

Open **Coach → Images & screenshots** or `/#images`. Older uploads in Needs review can be categorised manually or with **Retag automatically**. If Safari still shows the previous interface, save any typed input, confirm sync, then use **Reload update** when shown or **Settings → Refresh app**. Do not clear website data to update the app.

See [the image library guide](images.md) for classification behavior, account isolation, category correction, exports and failure handling. Existing private-pilot infrastructure and monitoring limitations remain recorded in the operations runbook.
