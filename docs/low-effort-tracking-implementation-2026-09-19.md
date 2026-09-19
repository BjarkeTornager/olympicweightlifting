# Quick capture, optional reminders and sleep import

Implemented for the web app. No Apple developer membership or native build is needed. Production deployment and physical iPhone verification are separate from the local tests described below.

## User flow

- Coach → **Log something** opens a small capture sheet. Photograph my meal uses the camera input and attaches a logging draft; Send uses the existing Coach save/Undo flow. Type or dictate focuses the existing message, preserving any draft. Recent/favourite meals can be added to today with **I ate this**, keeping portions and estimate labels, clearing a previous complete-day declaration, and offering a targeted Undo.
- `/#coach/capture` opens that same sheet. The web manifest exposes it as a shortcut on browsers that support manifest shortcuts. iPhone users can open the installed Home Screen app and tap Log something.
- Settings → **Reminders & Apple Health** is collapsed by default. Reminders remain off until the person explicitly enables them and grants browser permission. A chosen time and IANA time zone control delivery to one selected browser/device per account. Re-enabling on another device replaces the destination. Turning off clears the server subscription.
- Food reminders require no meal recorded and no explicit complete-day declaration. Sleep reminders require no duration recorded. Training reminders cover an unfinished workout dated today; absence of training alone is not a reason to notify. Notifications contain generic text and open quick capture.
- The sleep connection shows its last successful check, waking date and whether a manual entry was preserved or the latest attempt failed. A key is revealed once, can be replaced or disconnected, and only authorizes sleep import. It never reads the journal or enables training/food writes.

## Server setup for publication

1. Apply migrations through the existing Railway pre-deploy `node migrate.cjs` command. `0009_quick_leader.sql` adds three account-scoped tables with cascading foreign keys; no existing records are rewritten.
2. Generate one persistent Web Push VAPID key pair using the installed `web-push` package. Store its `publicKey` as `WEB_PUSH_PUBLIC_KEY` and `privateKey` as `WEB_PUSH_PRIVATE_KEY` in server secrets. Do not commit, paste into chat, or regenerate keys for every deploy.
3. Set `WEB_PUSH_SUBJECT` to the site's HTTPS URL or an operator `mailto:` address, and `DAILY_REMINDERS_WORKER=1`. If the subject is empty, `BETTER_AUTH_URL` is used. Railway's app must remain running for timed delivery. The optional worker starts through Next instrumentation; it is explicitly disabled in browser tests.
4. Deploy the tested source. A clean archive avoids including local secrets/artifacts. The service-worker build embeds `scripts/service-worker-push.js` in the existing offline worker, retaining API/auth cache exclusions. Existing installations must activate the offered app update before enabling reminders.
5. On the iPhone, add the website to the Home Screen, open it there and enable the reminder. Test real delivery while the app is closed, subject to iOS notification/Focus settings. No subscription or reminder has been enabled on behalf of any user by the implementation.

The worker checks once per minute. A database row lock claims each local date before an external send, preventing duplicate sends across server processes. There is a 90-minute catch-up window after the chosen time and a one-hour push TTL. A failed or ambiguous send is not retried that day; the next scheduled day can try again. Expired subscriptions are disabled. This favors avoiding duplicate prompts over guaranteed delivery after a process crash. Server outages, device connectivity and OS notification settings can prevent or delay a notification.

## Apple Shortcuts bridge

The in-app guide describes a manually constructed iPhone Shortcut. The phone selects sleep samples from noon before the waking date to noon on that date, converts sample timestamps to ISO 8601 with offsets, maps asleep stages to the supported values, and posts this shape:

```json
{
  "date": "2026-09-19",
  "timezone": "Europe/Copenhagen",
  "samples": [
    {"start": "2026-09-18T23:00:00+02:00", "end": "2026-09-19T07:00:00+02:00", "value": "asleep"}
  ]
}
```

This is an illustrative payload, not a record to import. POST to `/api/integrations/apple-health/sleep` with `Authorization: Bearer <the private import key>` and `Content-Type: application/json`. The service accepts at most 1,000 samples / 180 KB and waking dates within the last 14 days. Values are `asleep`, `core`, `deep`, `rem`, `awake`, or `inBed`. Awake and in-bed samples contribute no sleep. Overlapping asleep intervals are merged before measuring elapsed minutes, including across DST changes. Select a trusted source in Shortcuts where possible; compare with Apple Health because multiple sources can disagree.

The browser cannot directly query HealthKit. The Shortcut must first be tested while the phone is unlocked and after Watch sync. A morning automation may fail when health data is locked; keep an unlocked one-tap retry and inspect the last-success status. There is no prebuilt/signed Shortcut artifact and no claim of unattended device-tested sync. This release imports sleep only; workouts, lifting sets and their weights/reps are not inferred.

## Preservation and privacy

Imports take the account journal lock and save through its existing revisioned writer, so concurrent device edits conflict rather than disappear. Reordered/duplicate equivalent samples do not create another entry or revision. Changed measurements update an untouched imported entry. Manual sleep edits remove import provenance; manual values and deletions take precedence on later imports. Per-date receipts survive disconnect/reconnect to prevent deleted imports returning. Other check-in fields are preserved. Source and import time are visible in check-in details and journal backups.

Credential hashes, not raw import keys, are stored. Management endpoints require the current account and same-origin session; bearer import requires current membership and a narrowly scoped credential. Payloads are bounded, requests rate-limited and private responses non-cacheable. Push endpoints are restricted to known browser push services to prevent arbitrary server URL requests. Tests use synthetic accounts and mocked push transport; no production health records or real notifications are sent.

## Verification

Final validation passed: production build, TypeScript checks, ESLint, all 229 application tests (no skips), and 72 browser checks across Chromium, WebKit and Firefox (no retries or skips). The new capture sheet passed automated WCAG A/AA checks. Phone capture and setup screenshots were also inspected. Synthetic screenshots and a verification record are in `artifacts/low-effort-tracking-2026-09-19/`.

Tests cover overlapping stages and sources, wake-date bounds, DST, explicit-zero versus missing sleep, manual corrections, concurrent retry, isolated accounts, revocation/rotation, malformed payloads, restricted push destinations, permission denial, opt-in/out, duplicate reminder claims, recorded-data suppression, expired subscriptions, generic notification clicks, usual-meal capture/Undo, draft preservation and phone layout. Real iPhone notification delivery and the manually assembled Shortcut remain acceptance checks on the user's device.

Older cached web clients receive sleep values without the new provenance field, keeping their strict schemas usable. A write from an older client that omits provenance is conservatively treated as a manual entry by later imports. Refresh the app to keep automatic updates of untouched imported entries.
