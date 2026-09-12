# Google sign-in error handling — Railway release, 6 September 2026

- Live app: https://lift-journal-production.up.railway.app
- Source: `43ddb10230ce2f28836c0758cc86872b2c5bf3ce`.
- Railway deployment: `5b48c8c8-7772-4d24-b7c1-15f259f04058`, **SUCCESS**, created `2026-09-06T21:30:54.098Z`.
- Successful exact-source CI: [push 34060878140](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34060878140) and [PR 34060880125](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34060880125).

The Google profile admission hook can reject an account with a bare JSON 403 response during browser navigation. This is consistent with the reported blank page and `google.json` download. A synthetic OAuth flow reproduced that response; no real account was used to reproduce the failure. The user separately confirmed successful login with the intended Gmail account.

The Google callback route now converts error responses and unexpected exceptions into an empty 303 redirect to the public sign-in page. It preserves OAuth-state cookie cleanup. Successful browser and native-bridge redirects retain their destinations and session cookies; other authentication API failures retain JSON semantics. Google verification, owner/invitation admission and account isolation are unchanged.

Verification passed:

- Production type checking, lint, build, 23 progression tests and 59 domain/database/authentication tests. CI also passed the dependency audit and all 105 browser tests.
- Synthetic callback coverage includes an uninvited identity, an unverified owner identity, no user/session creation for rejected identities, successful non-Gmail Google identities, web/native destinations, invalid state and an unexpected provider exception.
- All 21 affected local browser checks passed across the login/privacy/native-bridge runs. Three live callback-page checks passed in Chromium, WebKit and Firefox, with synthetic session traffic intercepted and no real Google login.
- Live malformed callback POST returned 303, `Location: /?signin=failed`, private/no-store caching, an empty body and no download header.
- Live anonymous-access audit passed. Health/readiness returned 200; anonymous session exposed no user, kept Google enabled and password login disabled, and denied invitation management.

Only the committed source archive was uploaded. No database schema or health-record migration was introduced. The iPhone distribution assessment is in [the distribution guide](../ios/DISTRIBUTION.md); Apple signing and TestFlight submission remain outstanding.
