# Coach experience release — 6 September 2026

Live at [Coach](https://lift-journal-production.up.railway.app/#coach). Railway deployment `efce70f1-ff1c-4e1d-9e8a-3757c1ff083a` is `SUCCESS`, created at 14:49 UTC (16:49 Copenhagen). Source: `773be9f5659ef03b4fca7d221001f81ca55eb776` on `codex/agent-first-journal`.

## Experience

Coach opens into Conversation at the latest exchange. Today contains the daily overview, and switching the two views preserves the unsent message and private attachments. The conversation scrolls independently of the composer. Food and sleep shortcuts prepare text without silently sending it or replacing a draft. Image capture/upload and automatic tagging settings are available from the plus button; attached images use compact previews with category badges and remove controls.

The latest six exchanges appear initially. Earlier messages reveals older saved exchanges, Latest message returns to the newest one, and Review jumps to an unexpired proposal, including one outside the initial six exchanges. Saved and undone changes collapse into summaries that can be expanded for details, journal navigation and an available undo. Responses use escaped paragraphs, headings, numbered/bulleted lists and bold/italic emphasis. Raw HTML and model links remain inert.

No database schema, journal data model, provider configuration or save/undo API changed. The mobile shell responds to visual viewport changes to keep composing controls above the keyboard. Sync errors and pending changes remain visible; routine save timestamps no longer compete with the Coach header.

## Verification

- Local production build, type checking, lint and all 114 checks passed: 23 progression tests, 34 domain/database/auth/provider/rendering tests and 57 browser workflows.
- Browser checks cover Chromium, WebKit and Firefox; 320–1440 px widths; WCAG A/AA; 18-exchange history; collapsed saved entries; pending review navigation; existing save/undo; meal and sleep flows; unsent text and attachment preservation; image tools and privacy navigation; and a simulated mobile visual viewport reduction. A physical iPhone was not used for this release.
- Synthetic mobile and desktop screenshots were inspected, including a long conversation and a sleep-image draft. No production journal records were copied into the test fixtures or screenshots.
- [Linux push CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34040112838) and [pull-request CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34040114269) passed installation, disposable database migrations, production checks, dependency audit, production build and the full browser suite.
- The release was uploaded from an exact Git archive. Private environment files, credentials, untracked artifacts and local dependencies were excluded.
- Railway build and readiness gates passed. Startup confirmed migrations/catalogue seeds completed and the app became ready. Live health/readiness returned 200; unauthenticated journal, agent and image routes returned 401 with private/no-store headers. Unauthenticated image mutations were rejected before processing.
- Service worker cache: `lift-cloud-J_74w--H7RRhAq7PM6i8L`, served with `no-cache, no-store, must-revalidate`. API routes remain excluded from caching.
- A fresh signed-in Chrome tab verified the deployed Conversation/Today switch, readable historical replies, collapsed saved meal/check-in/sleep entries, composer controls and Coach options links. The account showed Ready to help and All changes synced. No assistant request or journal mutation was submitted; existing tabs and drafts were not refreshed. The new tab was left on Conversation.

## Recovery

Encrypted pre-release backup: `railway-2026-09-06T14-43-25.056Z.pgdump.enc`, stored privately outside Git. The prior healthy application deployment is `377a5fca-af6f-4c26-926a-251588f36d69`. Existing private-pilot infrastructure and recovery limitations remain recorded in the operations runbook.

If Safari still shows the old interface, preserve any typed draft and confirm sync before using Reload update or Settings → Refresh app. Opening the live link in a new tab fetches the current online interface without refreshing an existing draft.
