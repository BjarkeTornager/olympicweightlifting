# Private access boundaries

The Railway app requires a current server-verified session before mounting any journal screen. This applies to profile/settings, Coach, workouts, history, progress, meals, sleep/check-ins and images, including direct hash links. A cached identity, saved IndexedDB record or public offline shell cannot authorize access.

## Public surface

The landing/sign-in screen, privacy notice, OAuth endpoints, generic application assets and minimal health/readiness status remain public. An anonymous session check returns no user. There is no public user directory or profile route. API/auth responses use `private, no-store`; the service worker excludes them. Static application code is public and must contain no account records or secrets. The modern catalogue import is separated from the legacy single-athlete defaults so old profile/PR fixtures, personal coaching details and prescribed starting weights are absent from the Railway browser bundle.

Journal, image, conversation and proposal APIs derive ownership from the authenticated server session. They require the matching account header, and mutations also require a trusted origin. Supplying a different user ID in a query cannot select that person's journal. Individual images have no public storage URL. Database ownership is enforced by server queries and composite constraints; PostgreSQL row-level security is not enabled.

## Session and device behavior

- The app verifies the session before first opening, on visibility/page resume and reconnect, and every 15 seconds while visible. Expiry and private API 401 responses lock the interface. Server access checks apply to every private request, independent of UI polling.
- Hidden/background pages conceal the private shell before rechecking. Network failure shows the public locked state. Temporary verification preserves mounted in-memory drafts out of view; confirmed sign-out/invalid authorization unmounts the private app.
- Different accounts mount separate journal instances and read only their own device-storage key. Confirmed local copies and old cached identities/conversation entries are removed when the private instance is discarded. Normal sign-out blocks until pending edits sync or are resolved, then signs out and clears the confirmed copy.
- Unsynced IndexedDB edits are retained to avoid destroying user work. They require the owner to sign in again to recover through the application. IndexedDB itself is not encrypted by the app, and website authentication is not protection against someone who controls the device/browser developer tools.
- A disconnected old app version, previously downloaded file or exported backup cannot be erased remotely. Previously open old-version tabs require the update. Clear website data on shared devices after saving any needed work.

The privacy requirement intentionally replaces guest logging and unlocked offline access. A cold offline start cannot open account data.

## Verification

`tests/access-database.test.ts` creates two real Better Auth accounts only in a disposable PostgreSQL test database. It checks own-account reads, mandatory/mismatched account headers, foreign image bytes/metadata/edits/deletion/classification, foreign proposal save/undo, conversation isolation, session lists, anonymous writes and untrusted origins. Existing authentication tests also cover tampered/expired cookies, revoked sessions, invitation enforcement and disabled production password login.

`tests/browser/access.spec.ts` tests logged-out deep links with seeded sensitive device records, no private-data flash/API requests before verification, account switching, revocation, sign-out/back navigation, expired sessions and failed/offline cold starts. These run in Chromium, WebKit and Firefox with synthetic records. Other browser tests verify normal authenticated workflows and pending-edit recovery after reconnection. Automated WebKit is not a substitute for physical iPhone testing.

The anonymous deployed HTTP audit checks session/user-listing routes, journal/chat/image APIs, private-looking paths, accidental file exposure, cache headers and CORS. Production bundle inspection checks that known local secret values and legacy private defaults are absent and browser source maps are not emitted. These checks establish the tested boundaries; they are not an exhaustive penetration test or proof that no historical exposure occurred. Existing operational limitations remain in the operations runbook.
