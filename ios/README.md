# Lift Journal for iPhone

A native SwiftUI client for the existing private Railway health journal. Requires iOS 18 or later and Xcode 26.3 or later. There is no embedded web view, third-party SDK, Apple Health integration, wearable integration or background sensor collection. Google sign-in uses Apple's secure web authentication session.

## Preview

Passing iPhone simulator screenshots with synthetic data: [Coach](previews/native-coach.png), [Today](previews/native-today.png), [Cardio](previews/native-cardio.png), and [private reconnection](previews/native-private-reconnect.png).

## Run in the simulator

Open `LiftJournal.xcodeproj`, select the **LiftJournal** scheme and an iPhone simulator, then Run. No Apple Developer membership is needed. The normal app connects to `https://lift-journal-production.up.railway.app`; sign in with the owner or an invited Google account. An invitation does not share another account's journal.

The checked-in project needs no project generator or package installation. If you add Swift source files, regenerate it with `python3 ios/generate-project.py`. Preserve your personal signing settings locally; do not commit certificates, profiles or account credentials.

## Install on your own iPhone with a free Apple account

1. Add your Apple Account in **Xcode → Settings → Accounts**.
2. Connect and trust your iPhone. Enable Developer Mode on the phone if Xcode requests it.
3. Select the LiftJournal app target's **Signing & Capabilities**, enable automatic signing and choose your **Personal Team**. If Xcode requires a unique bundle identifier, choose one for this personal installation.
4. Select your iPhone as the destination and Run. Follow any device trust prompt.

Free personal provisioning expires after seven days, so you may need to run the app from Xcode again. TestFlight and App Store distribution require an Apple Developer Program membership. This repository contains a buildable app; it does not imply a signed installation, TestFlight availability or App Store approval. No membership purchase or enrollment is performed.

Apple: [membership options](https://developer.apple.com/support/compare-memberships/) and [running on a device](https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device).

## Native workflows

- **Coach:** AG-UI streaming conversation, stable reading position, native keyboard composer, camera/photo picker, categorized attachments, expandable proposals, review/save/undo, tables, bar charts and connected diagram steps.
- **Today:** reported sleep, food intake, weekly movement and journal-based next steps; quick activity, food and check-in forms.
- **Train:** five programmes including Gym Accessories, active workout continuation, exact loads/reps, made/miss, finishing logged work, 23 technique guides and YouTube links, cardio history and weekly chart.
- **Journal:** searchable strength, cardio, food and recovery history, activity corrections and entry deletion. Food adds meal-type and food-group filters, ingredient search, and editing of saved meal/ingredient tags with visible estimate labels. The image library keeps Food, Sleep, Activity and other categories separate, with manual corrections.
- **You:** account, owner-only invitation management, refresh, JSON export, pending-save recovery and sign-out.

Manual forms use the server's existing domain rules. Coach proposals are never automatically committed. Missing optional measurements remain absent; reported activity calories stay separate from food intake. Native JSON editing preserves unrelated journal fields.

This first native version does not yet provide every advanced web control: backup import/merge, routine editing, exercise reordering, the rest timer, detailed strength PR comparisons, and a separate diet-target editor remain available on the web (Coach can prepare diet targets). It requires connectivity to verify access and obtain a prepared manual save. Confirmed data is held in memory, not available on an offline cold start. Unsaved form text is kept while that form remains open; prepared pending writes survive app restarts.

## Authentication and privacy

The app creates a PKCE verifier and state, then opens `/mobile` in `ASWebAuthenticationSession`. Google completes on the existing Railway origin. The user explicitly connects the app; the browser receives a random, single-use two-minute code bound to the PKCE challenge. The fixed `liftjournal://auth` callback carries code and state only. The app validates state, exchanges code plus verifier over HTTPS, and stores its separate signed session in Keychain with `WhenUnlockedThisDeviceOnly` protection. It never embeds an OAuth client secret or provider key.

The server checks verified owner/invitation admission during handoff and every private API request. Signed Bearer sessions use the same account checks, origin checks and revocation rules as the website. Native sign-out revokes only that device's session. The network client refuses redirects and uses an ephemeral session without cookie or response caches. Private screens, including presented sheets, are covered in a separate privacy window when inactive or awaiting account verification.

A prepared save is written to an account-namespaced file with complete iOS file protection and backup exclusion before submission. Each payload retains the same mutation ID and revision for an exact retry. No optimistic success is displayed before server acknowledgement. Recovery offers retry, export and explicit discard; it does not overwrite another device's revision. Exports contain sensitive user data and are created only by the user's action. The image catalog and pixels remain private on the server; JSON exports do not include pixels.

`PrivacyInfo.xcprivacy` declares account identity, health, fitness, images and other user content collected for app functionality, linked to the user's account, without tracking. Before any future public distribution, review the actual hosting/provider practices, privacy disclosures, required account-deletion flow, signing and App Store requirements. Real Google handoff, camera use and physical device keyboard/app-switcher behavior still require an on-device acceptance pass.

## Verify without touching real health data

The fixture is an explicit, localhost-only synthetic API. It uses the actual domain preparation rules, but never calls Railway, PostgreSQL, Google or the Coach provider. The `LIFT_TEST_SERVER` override and synthetic token are compiled only in Debug; Release always uses the fixed Railway origin.

```sh
# From the repository root, keep this terminal running:
LIFT_IOS_FIXTURE=true node --import tsx scripts/ios-fixture.ts

# In a second terminal, substitute an available iPhone simulator name:
xcodebuild -project ios/LiftJournal.xcodeproj -scheme LiftJournal \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -parallel-testing-enabled NO -derivedDataPath /tmp/lift-ios-build \
  CODE_SIGNING_ALLOWED=NO test

# Compile the physical-device release without claiming a signed install:
xcodebuild -project ios/LiftJournal.xcodeproj -scheme LiftJournal \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/lift-ios-device CODE_SIGNING_ALLOWED=NO build
```

Native unit tests cover lossless round trips, callback binding, precise durations, missing values and invalid numbers. Native UI tests cover cardio/Coach review, sleep/food/strength forms, ingredient logging and saved-meal group edits, interrupted acknowledgement retries and private-sheet hiding on offline reactivation. Backend tests use a disposable `_test` database to cover signed sessions, wrong proof, expiry, replay, revocation, account isolation, read-only preparation, stale revisions and duplicate retry. Browser tests cover the Google bridge and the existing web workflows.

Food structure and query examples: [Food records and Coach queries](../docs/food-data.md). [Native food tags preview](previews/native-food-tags.png) uses synthetic data.
