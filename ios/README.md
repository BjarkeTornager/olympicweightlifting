# Lift Journal for iPhone

A native SwiftUI app for the Lift Journal backend on Railway. It uses the same server and database as the website. It is tested through TestFlight: internal testers, plus external testers who join from a public link or QR code. See the [plan](../docs/native-ios-app-plan-2026-09-26.md) and the [external beta runbook](../docs/external-testflight-beta-2026-09-26.md).

- **Name:** Lift Journal on the home screen. Suggested App Store name: "Lift Journal: Train & Recover".
- **Bundle ID:** `com.bjarketornager.liftjournal`. **Team:** 9B79882UPS (individual membership).
- **Requirements:** iPhone with iOS 26 or later. Built with Xcode 27 and the iOS 27 SDK, in Swift 6 language mode.

## What it does

- **Today:** Health-style summary cards for sleep, heart, activity, how you feel, water, food and training. Each card opens a Swift Charts view of the last week, fortnight or month (`/api/v1/trends`). It also has one-tap water and a check-in sheet.
- **Voice check-in:** the same spoken check-in as the website (Gemini Live with a single-use token from `/api/voice/session`; saves through `/api/voice/action`). Audio uses AVAudioEngine with Apple's voice processing for echo cancellation, and a call keeps going with the screen locked. The protocol lives in the `LiftVoice` module and mirrors `lib/voice-live.ts`.
- **Apple Health:** reads sleep with its stages, resting heart rate, HRV, average heart rate, steps, active energy, and every workout (runs, walks, rides, swims, rows, hikes and more) with distance and heart rate. Workouts recorded with GPS bring their route: the phone simplifies it to at most 200 points and names the start, end or turning point with Apple Maps; Coach gets the place names only, and Journal and Today open the map. New data arrives in the background through HealthKit background delivery. Nothing is written to Apple Health.
- **Coach:** the same conversation as the website, streamed over AG-UI, in Messages style. Replies render natively: headings, nested lists, tables, quotes and code. Coach's visuals render as native components: tables as grids, bar charts in Swift Charts, diagrams as steps, photo galleries, and routes on Apple Maps. You can attach photos from the camera or library, and Coach's saves come with Undo. A microphone in the text field starts a voice check-in.
- **Journal:** everything recorded, a fortnight at a time, with the standard search field and a filter menu. Entries that came from Apple Health are marked.

Programmes, routines, set-by-set training, lifting videos and backups are still on the website. They come next (see the plan).

## How it fits together

| Path | Purpose |
| --- | --- |
| `LiftJournal/` | App target: SwiftUI screens and `@Observable` models, default `MainActor` isolation |
| `Packages/LiftKit/Sources/LiftAPI` | Client generated at build time by Swift OpenAPI Generator from `openapi.json`, plus the Coach event stream |
| `Packages/LiftKit/Sources/LiftStore` | Keychain session, the offline change queue (`Outbox`), per-account cache, and the HealthKit reader (`HealthSync`) |
| `Config/` | Build settings (`*.xcconfig`), Info.plist additions and entitlements (HealthKit and background delivery) |
| `LiftJournal/Preview Content` | Synthetic preview data. It is a development asset and never ships in an archive |

The Xcode project uses folder-synchronised groups: a file added under `LiftJournal/` joins the app target automatically, and no project generator is needed.

**Contract with the server.** The app calls `/api/v1/*`: `config`, `today`, `journal`, `actions`, `health/sync` and `coach`. These views are shaped for the app and described by zod schemas in `lib/native-api.ts`. `npm run openapi` writes `Packages/LiftKit/Sources/LiftAPI/openapi.json` and the JSON fixtures the Swift tests decode, and a server test fails when either is stale. Responses are written to survive change: no closed enums, extra fields allowed, and timestamps as plain strings. The server can therefore add fields and values without breaking an installed build.

**Versioning.** Every request carries `X-Client: ios/<version>/<build>`. The server supports every build until `MIN_IOS_BUILD` is raised on purpose. After that, older builds get HTTP 426 and show "Install the latest build from TestFlight". The website's feature-version headers do not apply to the app.

**Saving.** Each change is one typed action with its own ID. It is queued on disk first, then sent to `POST /api/v1/actions`. The server applies it to the current journal and saves each ID only once, so an offline change never overwrites another device's work.

**Sign-in.** Google sign-in goes through the website with PKCE (`/mobile`, then `liftjournal://auth`, then `/api/mobile/token`). Apple's reviewer uses the App Review sign-in on the same page instead: a passcode (`APP_REVIEW_PASSCODE`) opens one fixed, empty account, and removing the variable turns it off. The app gets its own session, which better-auth extends each time the app uses it. It is stored in the Keychain on this device only, and is readable after the first unlock so background Health syncs work while the phone is locked.

## Build and test

```sh
# Swift tests (app and LiftKit) on a simulator
ios/scripts/test.sh

# Server side: contract, Apple Health import and actions
npm test
```

Open `ios/LiftJournal.xcodeproj` in Xcode 27 and run the **LiftJournal** scheme. The first time, Xcode asks you to trust the Swift OpenAPI Generator build plugin: choose **Trust & Enable**. On the command line, pass `-skipPackagePluginValidation`.

### Against a local server

Debug builds can talk to a local `npm run dev` server, with a disposable local account and synthetic Apple Health data in the simulator:

```sh
LIFT_SERVER=http://127.0.0.1:3100 LIFT_TEST_TOKEN=<bearer> LIFT_TEST_ACCOUNT=<user id>
```

Set these as environment variables in the scheme, or prefix them with `SIMCTL_CHILD_` for `xcrun simctl launch`. Add the launch argument `-seedHealth` to write a few days of synthetic sleep, heart rate and a run into the simulator's Health data. That seeder is compiled only for Debug simulator builds. Release builds always use the Railway origin.

## Ship to TestFlight

```sh
ios/scripts/testflight.sh
```

The script archives a Release build, sets the build number from the UTC time, signs it automatically for team 9B79882UPS using the Apple Account in Xcode, and uploads it. It appears under App Store Connect › TestFlight after processing and goes to internal testers without review. To reach external testers, add it to the external group; the first build of each version goes through Beta App Review. Builds last 90 days.

Before the first upload, these one-time steps are needed: the paid developer account in Xcode › Settings › Apple Accounts, at least one registered iPhone, and the app record in App Store Connect. Testers are App Store Connect users in an internal TestFlight group; the owner's everyday Apple Account is invited with the Marketing role.

Deploy the server before uploading a build that needs new endpoints. Never remove or rename a response field that installed builds read without raising `MIN_IOS_BUILD`.

## Privacy

`Resources/PrivacyInfo.xcprivacy` declares name, email, user ID, health, fitness, precise location (the GPS routes of workouts), photos and other user content. All of it is linked to the account, used for app functionality, and never for tracking. The app uses no third-party SDKs and no analytics, and logs no health values. The app switcher shows a cover instead of health data. Coach sends journal content to the server's AI providers, so the Coach tab asks for permission first (`AIConsent`, App Review guideline 5.1.2(i)); it can be withdrawn in Account and resets on sign-out. Account › Delete account removes the account and everything stored for it (guideline 5.1.1(v)).

The previous prototype (September 2026) is in Git history before this directory was rebuilt.
