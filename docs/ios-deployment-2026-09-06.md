# Native iPhone app — 6 September 2026

The first native SwiftUI app is implemented, built and simulator-tested. It shares the existing private Railway backend. Open `ios/LiftJournal.xcodeproj`; see [setup and privacy](../ios/README.md) and [synthetic Coach preview](../ios/previews/native-coach.png).

- Native app source: `367f7b8588f72ea4c8a5a650f36fa05d71220b0a`.
- Server source: `530c7a70accadbe80298baee86ddc5cc4a37a0c4`.
- Native source differs from server source only in `ios/`, which is excluded from the Docker build.
- Railway deployment: `eee95feb-6973-4695-aea5-b073ca4bad65`, **SUCCESS**, created 6 September 2026 at 19:57:29 UTC.
- Live server: https://lift-journal-production.up.railway.app
- Service worker: `lift-cloud-M8L0lFr1JzSX-zZXLF0ST`.
- Prior compatible application rollback: `aaabd740-9dff-469f-a9ee-d5be3f2a2cad`.

## Delivered

Coach, Today, Train, Journal and account tabs use SwiftUI, Charts, native photo/camera controls and the existing AG-UI stream. The app supports reviewed Coach proposals, visual tables/charts/diagrams, manual cardio/food/check-ins, strength programmes and sets, private categorized images, account export/recovery and owner-only invitations. The keyboard dismisses after a Coach run and workout completion stays in the toolbar. Advanced web-only controls and physical-device acceptance limits are listed in the setup guide. There is no Apple Health or wearable connection.

Google sign-in runs through Apple's authentication session and a fixed callback carrying only a short-lived PKCE-bound code. Exchange requires the original verifier, rechecks admission and the browser session, and issues a separate signed native credential. Keychain stores that credential. Every private API keeps the existing admission, account, origin and revision checks. Unsent prepared saves use complete iOS file protection and an exact mutation retry; private forms remain mounted beneath an opaque window while access is checked after inactivity.

## Verification

- **180 local checks passed:** 23 progression, 51 domain/database/auth/provider, 99 browser and 7 native tests (4 unit, 3 UI flows).
- Both exact-server-source Linux CI runs passed: push `34055662108`, pull request `34055664306`. They include fresh disposable PostgreSQL migrations, production dependency audit, build and all 99 browser checks.
- Xcode 26.3, iOS 26.2 iPhone 17 Pro simulator: native tests passed together in `/tmp/lift-ios-native-8.xcresult`. Tests cover lossless data, callback proof, invalid numbers, exact sleep/food/strength/cardio saves, Coach review, keyboard/navigation, lost acknowledgements and hiding/reopening a private form after offline reactivation.
- Release build for a physical iPhone passed with signing disabled. Its executable contains the fixed Railway host and no synthetic token or debug server override.
- Native previews were inspected and contain synthetic data only. Test fixtures never call production, Google or a live Coach provider.
- Deployed health/readiness and `/mobile` returned 200; anonymous session returned no user, Google enabled, password login disabled and no invitation capability. The public-access audit passed, including native overview denial and origin/account gates for native authorization/preparation. Six live connection-page checks passed in Chromium, WebKit and Firefox with synthetic API responses and no production sign-ins or health writes.
- A real Google handoff, physical camera capture, device keyboard/app-switcher behavior and personal provisioning still require an acceptance pass on the user's iPhone. The app is not installed on that phone or distributed via TestFlight.

A fresh encrypted production backup was not created: automatic approval review rejected the production-data copy because it lacked explicit authorization. Publication uses the previously authorized application-only release path and existing rollback. No new schema migration, health-data import or database restore is included. The previous encrypted backup and operational backup configuration were left alone. Release source was uploaded from an exact Git archive, excluding untracked artifacts and local credentials.

A free Apple Account can use Xcode Personal Team provisioning for a user's own device, with seven-day renewal limits. TestFlight requires Apple Developer Program membership. No enrollment, purchase or signing account change was performed.
