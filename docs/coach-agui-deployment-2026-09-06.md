# AG-UI Coach release — 6 September 2026

The release is live at https://lift-journal-production.up.railway.app/#coach. Railway deployment `49329ff0-7525-40dc-8510-31adf4ce38ad` is `SUCCESS`, created at 17:06 UTC (19:06 Copenhagen). Its source is `caed9c56269d770e6ad9a0dff4f49b3bfea95f62` on `codex/agent-first-journal`.

Coach now streams provider text through AG-UI, shows journal/tool activity, supports stopping a response, and generates private tables, bar charts and connected diagrams. Visuals persist with conversation history. The existing explicit review/save flow, account gate and phone scroll behavior remain in place. See [the integration guide](coach-agui.md) for the protocol contract, rendering limits and privacy controls.

## Verification

- All 145 checks passed for the deployed source: 23 progression tests, 44 domain/database/auth/provider tests and 78 browser checks. Type checking, lint, production build and dependency audit passed. The audit found zero known production vulnerabilities. [Push CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34047200423) and [PR CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34047203863) both succeeded.
- A real OpenRouter model run used only a synthetic account in a disposable test database. It retrieved that account's health data, generated all three visual kinds, charted the exact logged values (7, 8 and 7.5 hours), streamed seven text events, retained visuals in private history and left the journal revision unchanged. The synthetic account was deleted afterward.
- Six focused live checks passed against the deployed assets in clean Chromium, Safari/WebKit and Firefox contexts. They covered streamed partial text, progress, rich views, accessible phone layouts, deliberate reading, history reload, cancellation, incomplete responses and explicit Save. The browser harness intercepts account/chat APIs with synthetic responses and creates no production records. It waits for the lazy client download before injecting stream events. This is browser-engine coverage, not a physical iPhone test.
- The live public-access audit passed. `/api/agent/run` returned 401 without a session and 403 for an untrusted origin; neither opened a stream. Other private APIs remained protected and private file/user routes were unavailable. Health and readiness returned 200.
- The live service-worker cache is `lift-cloud-eZB11hxfSjp26LrFY2kWR`. Existing tabs must load the update to use the new client; preserve any unsent draft before reloading.

Deployment used an exact Git archive excluding local secrets and private artifacts. There is no SQL migration, public image storage, new account provider or additional CSP permission. An encrypted pre-release database backup was completed: `railway-2026-09-06T16-57-02.932Z.pgdump.enc` (737,281 bytes), stored privately outside Git. Existing pilot operations limitations remain documented in the runbook.
