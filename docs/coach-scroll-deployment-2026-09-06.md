# Coach mobile scroll release — 6 September 2026

The fix is live at https://lift-journal-production.up.railway.app/#coach. Railway deployment `4c4028d2-bac6-4d3a-85c1-bac119febacd` is `SUCCESS`, created at 16:16 UTC (18:16 Copenhagen). The source is `6800a10f7f68263f5ffe8b0961014ec7e8bca3ad` on `codex/agent-first-journal`.

Sending a question now anchors the latest exchange while the keyboard closes and the answer expands. The composer remains in the visible phone viewport. Deliberate wheel, touch, scrollbar or keyboard navigation pauses automatic scrolling; Latest message returns to the newest exchange. Brief session concealment preserves reading position while retaining the existing authentication gate.

The old implementation scrolled once when a turn ID appeared. It did not follow later reply/layout changes. The WebKit regression also showed that input blur could restore the full header before the keyboard had closed, moving Send between pointer-down and click. The compact layout now remains until the viewport recovers. Resize observation, space reserved for a short pending exchange, and viewport resize/scroll handling keep the conversation stable. See [MDN's visual viewport documentation](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) for how mobile keyboards and viewport offsets differ from the layout viewport.

## Verification

- Type checking, lint, production build, 23 progression tests, 35 domain/database/auth/provider tests and 72 browser checks pass locally and in Linux CI. The production dependency audit reports zero vulnerabilities. [Push CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34044630310) and [PR CI](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34044632167) passed for the deployed source.
- The new browser regression checks a single Send click with a reduced/panned visual viewport, multiple delayed keyboard-dismissal events, a long asynchronous reply, manual reading during the next reply, session hide/show recovery and Latest navigation. It failed on the previous WebKit build and passes in all three engines with the fix.
- The same focused regression was repeated against the deployed HTML/JavaScript in clean Chromium, WebKit and Firefox contexts. All three passed. These live UI tests intercept account/chat APIs with synthetic data; they create no production records or model requests. Keyboard movement is simulated, not a physical iPhone test.
- Live health/readiness returned 200. The public-access audit passed, including anonymous private API denial, no exposed user/private-file routes and no-store API responses. The deployed service worker is `lift-cloud-ZOUjFCXJH_6n_4En6s3IW`.

The release was uploaded from an exact Git archive excluding local secrets and private artifacts. No schema, stored-record, authentication-rule or provider-setting change is included. Encrypted pre-release backup: `railway-2026-09-06T16-08-03.977Z.pgdump.enc`, stored privately outside Git. Existing tabs need to load the update after preserving any draft. Existing operational limitations remain in the operations runbook.
