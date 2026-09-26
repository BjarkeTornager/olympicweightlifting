# Native iPhone app: plan to TestFlight — 26 September 2026

Goal: a native SwiftUI iPhone app for Lift Journal that uses the same Railway backend and PostgreSQL database as the website. TestFlight comes first, so the app can be used and tested on real phones before any App Store submission.

It replaces the 6 September decision in [ios/DISTRIBUTION.md](../ios/DISTRIBUTION.md) to skip TestFlight.

## Progress (26 September, evening)

**Owner decisions:**
- **Testers:** only the owner at first, on the everyday Apple Account `bjarketornager@gmail.com`, as an internal tester.
- **Start fresh:** yes.
- **Names:** home-screen name "Lift Journal"; suggested App Store name "Lift Journal: Train & Recover"; bundle ID `com.bjarketornager.liftjournal`.
- **Apple Health:** in the first build, reading sleep, heart rate and all workouts.

**Built:**
- **Server:** `/api/v1` config, today, journal, actions, health sync and coach. Native builds are recognised by `X-Client`. Apple Health workout imports have their own receipts table (migration `0011`). The daily heart-rate and movement summary is stored as `health.vitals`.
- **Contract:** an OpenAPI document and synthetic fixtures generated from zod.
- **App:** a new Xcode 27 project in `ios/`, with sign-in, Today, Apple Health sync (including background delivery), Coach with photos, Journal, the offline queue and Account.

**Verified:**
- **Server:** full check (typecheck, lint, 320 tests), plus a PostgreSQL test of once-only saves and the Apple Health import rules.
- **Swift:** 13 tests (contract decoding, HealthKit mapping, photo resizing).
- **Simulator, end to end:** against a local server and a disposable account, synthetic Apple Health sleep, heart rate, steps and a run reached the journal and showed on Today and Journal. A water save and the Coach error state work.

**Changed from the plan:**
- No session-refresh endpoint is needed: better-auth already extends the app's session each time it is used.
- Coach history is read from the new `/api/v1/coach` view, not parsed from the stream.

**Released to TestFlight:**
- The owner's iPhone is registered to the team; Apple needs one device before automatic signing works for a new account.
- The App Store Connect record "Lift Journal: Train & Recover" exists.
- Build 0.1 (262691716) was uploaded with `ios/scripts/testflight.sh` as TestFlight Internal Only.
- The server ships with this change; Railway deploys `main` automatically.

**Next:**
- Add the owner to an internal TestFlight group and install.
- Then: Train with set logging and a rest-timer Live Activity, push reminders, widgets and App Intents, native voice, and video.
- The EU trader status in App Store Connect is needed only before App Store distribution in the EU, not for TestFlight.

## Decisions in brief

| Topic | Recommendation |
| --- | --- |
| Starting point | New Xcode 27 project in `ios/`, porting the parts of the September prototype that worked. Do not keep extending the prototype (reasons below). |
| Backend | Same Next.js app and database. Add a small versioned native surface, `/api/v1/…`, described by an OpenAPI document generated from the existing zod schemas. |
| Swift client | Generated at build time by Apple's Swift OpenAPI Generator: typed `Codable` models, not untyped JSON. |
| Platform | iPhone. iOS 26.0 minimum, built with Xcode 27 and the iOS 27 SDK, Swift 6 language mode. iPad and resizable layouts later. |
| Interface | SwiftUI and Observation with standard system components, so Liquid Glass, Dark Mode, Dynamic Type and VoiceOver work out of the box. No web views for core features. |
| Writes | One typed journal action per request with an idempotency key, applied on the server. Actions queue offline, so sets can be logged in a gym with no signal. |
| Native-only value | HealthKit (sleep, bodyweight, workouts), push reminders with quick actions, a Live Activity rest timer, widgets and App Intents, native voice audio with echo cancellation, and background video upload. |
| Distribution | Internal TestFlight first, which needs no review. External TestFlight after Sign in with Apple, account deletion, AI consent and a reviewer account exist. |
| CI | Xcode Cloud (25 compute hours a month are included). Pull requests build and test; `main` archives and delivers to the internal TestFlight group. |

Why iOS 26.0 and not 27: iOS 27 (released 14 September 2026) runs on exactly the same iPhones as iOS 26 (iPhone 11 and later). A 26.0 minimum costs no devices and does not force testers onto a two-week-old OS. It still includes Liquid Glass, `tabViewBottomAccessory`, HealthKit workout sessions on iPhone and HTTPS callbacks for web authentication. iOS 27-only APIs go behind `#available`. Apple requires uploads built with the iOS 26 SDK or later since 28 April 2026; Xcode 27 meets that.

## Where we are starting

### Shared backend

- Next.js 16.3 on Railway with PostgreSQL. better-auth provides Google sign-in and the bearer plugin. Admission is limited to the owner and invited emails.
- Each account's journal is one JSONB snapshot with a revision. The website writes the whole snapshot (`PUT /api/journal` with `revision` and `mutationId`).
- About 40 typed journal actions already exist in `lib/agent/action-schema.ts`. Coach and voice apply them on the server; `POST /api/voice/action` is idempotent by call ID.
- Coach streams AG-UI events over SSE (`POST /api/agent/run`). Voice check-in gets a single-use Gemini Live token from `POST /api/voice/session`, and the client talks to Google over WebSocket.
- Other features: lifting videos (up to 50 MB) with analysis, images and food photos, reminders over Web Push, and Apple Health sleep imported through a Shortcut and import key.

### The September prototype (`ios/`)

About 2,900 lines of SwiftUI in 12 files, targeting iOS 18, with Coach, Today, Train, Journal and You tabs. It passed simulator tests and was never installed with a signed build.

**Worth porting:**
- the PKCE sign-in handoff (`/mobile`, `/api/mobile/authorize`, `/api/mobile/token`) and Keychain storage
- the privacy cover in the app switcher
- exact-retry pending saves
- the localhost fixture server (`scripts/ios-fixture.ts`) and its UI-test scenarios

**Reasons not to extend it:**

- **It has already drifted from the backend.** `/api/agent/run` now requires the `x-coach-journal-version: 1` and `x-training-programs-version: 2` headers (`lib/agent/http.ts`, `requireCurrentCoach`). The app never sends them, so native Coach gets `426` today. Untyped JSON with no contract tests let this pass unnoticed. Anything built on the snapshot will drift the same way.
- **It will not grow to today's features.** All data is an untyped `JSONValue` and one 365-line `JournalStore` owns all state. The website has since added hydration, body goals, programmes v2, weekly review, voice, lifting videos, Coach memory and reminders.
- **The Xcode project is generated by a Python script** (`ios/generate-project.py`). Xcode's folder-synchronised groups make that unnecessary, and generated projects break when capabilities and extensions are added in Xcode.
- **Native sessions expire** after at most 30 days (`lib/mobile.ts`), and there is no refresh.
- **Background sync cannot read the token.** The Keychain item uses `WhenUnlockedThisDeviceOnly`, so nothing can sync while the phone is locked. That rules out HealthKit background delivery (sleep arrives in the morning, often while locked) and background uploads.

### Apple account

- Individual membership in the name Bjarke Rasmus Tornager; the developer Apple Account is `bjarketornager.dev@gmail.com`.
- The account page says no payment card is on file. Add one so the membership renews; if it lapses, TestFlight distribution stops.
- Local tools: Xcode 27.0, Swift 6.4, macOS 27. Only the iOS 26.2 simulator is installed; add iOS 27 under Xcode → Settings → Components.

## Scope for each TestFlight build

The app is organised around the four destinations proposed in the [usability review](usability-simplification-review-2026-09-19.md): **Today, Train, Coach, Journal**. The account sits behind a toolbar button. An active workout or running rest timer shows as a bottom accessory above the tab bar, like the mini player in Music, so it can be reached from any tab.

| Build | Testers | Contents |
| --- | --- | --- |
| 0.0: pipeline | You (internal) | A signed shell with the icon and sign-in screen, uploaded through the same pipeline all later builds use. It proves signing, upload, processing and installation before any features exist. |
| 0.1: daily loop | You (internal) | Google sign-in. Today. Quick logging sheets for meal (with photo), drink, sleep, cardio and check-in. Train with an active workout whose set logging works offline. Rest timer with Live Activity and Dynamic Island. Coach text and photos with streaming, receipts and Undo. Journal (read). Account screen with export and sign-out. |
| 0.2: native value | You + invited internal testers | HealthKit sleep and bodyweight import (replacing the Shortcut), cardio from Apple Health workouts, and finished strength sessions written to Health. APNs reminders with quick actions. Widgets and App Intents (log water, start today's workout, check in). Voice check-in with native audio. |
| 0.3: video | Internal | Record or choose lifting videos, background upload, analysis status and replay. |
| 1.0 beta | External testers | Sign in with Apple, invitation codes, in-app account deletion, consent for third-party AI, a reviewer account and an updated privacy policy. The first external build goes through Beta App Review. |
| Later | — | iPad and resizable layouts (iPhone apps become resizable on iOS 27), Apple Watch set logging, App Store release. |

These stay on the website for now: backup import and merge, routine and programme editing (Coach can do both), video plate calibration, and route planning with maps.

## App architecture

### Project layout

```
ios/
  LiftJournal.xcodeproj          created in Xcode 27, folder-synchronised groups
  Config/                        Debug.xcconfig, Release.xcconfig (server URL, bundle IDs)
  LiftJournal/                   app target
    App/                         entry point, root tabs, deep links, scene phase
    Features/                    Today, Train, Coach, Journal, Logging, Voice, Account
    Resources/                   asset catalog, PrivacyInfo.xcprivacy, Localizable.xcstrings
  LiftJournalWidgets/            widgets, Live Activity, controls (extension target)
  Packages/LiftKit/              local Swift package
    Sources/LiftAPI/             openapi.json + generator config, middlewares, AG-UI events
    Sources/LiftModel/           domain helpers, units, formatters
    Sources/LiftStore/           session, cache, outbox, sync
    Sources/LiftDesign/          colours, typography, shared components
    Tests/                       Swift Testing
  LiftJournalUITests/            XCTest UI flows against the fixture server
  ci_scripts/                    Xcode Cloud hooks
```

The app target and the widget extension share `LiftKit`. A shared App Group container lets widgets and App Intents read the cached Today summary and enqueue actions.

### Language and concurrency

- Swift 6 language mode with complete concurrency checking. Use the Xcode 26+ template defaults: `@MainActor` default isolation for the app target and approachable concurrency.
- Keep networking, caching and the outbox in `actor`s or explicitly `nonisolated` types. Mark models passed between them `Sendable`.
- Use async/await and `AsyncSequence` throughout, with no Combine. Use structured tasks tied to views (`.task`) so leaving a screen cancels its work.

### State and navigation

- Each feature gets its own `@Observable` model (for example `TodayModel`, `WorkoutModel`, `CoachModel`), owned by `@State` at the feature root and passed down or through `.environment`. A small `AppModel` holds session, account and connectivity. Avoid one global store.
- Use `TabView` with the `Tab` API, and a `NavigationStack` per tab with a typed path, so deep links, widgets and notifications can open a precise screen. Logging uses sheets with detents. Destructive actions use confirmation dialogs.
- Use `tabViewBottomAccessory` for the active workout and `tabBarMinimizeBehavior(.onScrollDown)` for long lists.

### Networking and the shared API

- Swift OpenAPI Generator runs as a build plugin with `swift-openapi-urlsession`. `openapi.json` is generated from zod on the server side and committed (see Backend changes). Generated code is not checked in.
- Middleware adds the Bearer token, `X-Journal-Account`, `Origin`, and `X-Client: ios/<version>/<build>`. It maps `401` to sign-out and `426` to an "Update in TestFlight" screen.
- The URLSession is ephemeral, with no cookies, no URL cache and no redirects (keep this from the prototype).
- Coach SSE and AG-UI events use hand-written `Codable` types over `URLSession.bytes`, with a reconnection path, because OpenAPI does not describe event streams well. The prototype's parser is a starting point.
- Voice uses `URLSessionWebSocketTask` to Gemini Live with the ephemeral token from `/api/voice/session`. The Gemini key never reaches the phone.

### Data, offline and sync

- The server is the source of truth.
- **Read cache:** the last Today overview and journal snapshot are saved as files in the App Group container with iOS file protection and excluded from backups. The app opens offline with read-only data and a clear "last updated" time.
- **Outbox:** every write is a typed action with a UUID, persisted before sending. Actions replay in order when connectivity returns. The server applies each action to its current state, so an offline set log no longer conflicts with a phone that saved something else in the meantime. The server de-duplicates retries by ID.
- **Protection levels:** files and the Keychain token use `completeUntilFirstUserAuthentication` and `AfterFirstUnlockThisDeviceOnly`, so HealthKit background delivery and background uploads can sync while the phone is locked. The privacy cover stays. An optional Face ID lock in Settings uses LocalAuthentication.
- SwiftData is not needed while the backend stores one snapshot per account. Reconsider it if the backend moves to entity-level sync.

### Sign-in

- **Google** keeps the existing PKCE handoff through `ASWebAuthenticationSession`, but switches from the `liftjournal://` scheme to an HTTPS callback on the Railway host (`.https(host:path:)`, iOS 17.4+). A custom scheme can be claimed by another app; an associated domain cannot. The Next.js app serves `/.well-known/apple-app-site-association`.
- **Apple** uses `SignInWithAppleButton` (AuthenticationServices) natively. The identity token goes to better-auth's `signIn.social` with `idToken`, configured with the bundle ID as an accepted audience.
- Sessions refresh before expiry, and the token rotates, so testers are not signed out every 30 days.

### Native features

| Feature | Framework | Notes |
| --- | --- | --- |
| Rest timer and active workout | ActivityKit + WidgetKit | `Text(timerInterval:)` counts down on the Lock Screen and in the Dynamic Island without pushes. A local notification fires when rest ends. |
| Sleep, bodyweight, workouts | HealthKit | Read sleep analysis (core, deep, REM, awake, in bed; this matches `sleepImportSchema`), body mass and workouts. Write finished strength sessions. Use `HKObserverQuery` with background delivery (needs the background-delivery entitlement). Health data never goes to iCloud (guideline 5.1.3). |
| Reminders | UserNotifications + APNs | Actionable notifications, for example "Log 250 ml" and "Check in". Time-sensitive only where the user opts in. |
| Shortcuts, Siri, Spotlight, Action button, Control Center | App Intents | Log water, log bodyweight, start today's workout, open voice check-in. Interactive widget for water. |
| Voice check-in | AVAudioEngine + AVAudioSession | `.playAndRecord` with `.voiceChat` mode and voice processing turned on. This gives echo cancellation, which the Safari version struggles with because of speaker echo. Capture at 16 kHz and play back at 24 kHz, as on the web. |
| Photos and camera | PhotosUI, AVFoundation | `PhotosPicker` for existing images, camera capture for meals, HEIC to JPEG on device. |
| Lifting videos | AVFoundation + background URLSession | Record at 60 fps, compress to fit 50 MB, and upload from a file with a background session so a locked phone does not stop the upload. |
| Diagnostics | TestFlight feedback, Xcode Organizer, MetricKit, `os.Logger` | No third-party SDKs. Log with privacy annotations, and never log health values. |

### Design

- Use system components first: lists, forms, toolbars, sheets and the tab bar. They pick up Liquid Glass and its iOS 27 changes automatically. Carry the journal's identity through the accent colour, type choices and a few custom views (set logger, day summary), not a re-creation of the web CSS.
- Follow the Human Interface Guidelines for tab bars, sheets, Live Activities and widgets. Use SF Symbols, Dynamic Type up to the accessibility sizes, Reduce Motion, and 44 pt touch targets. Make the set logger one-thumb friendly with large Made and Miss controls and haptics.
- Layouts must adapt to width (size classes, `ViewThatFits`), because iPhone apps are resizable on iOS 27. Use Xcode 27 preview resize handles to check.
- Use String Catalogs from the start, even though English is the only language for now.

### Testing

- Unit tests use Swift Testing: model decoding against the committed OpenAPI examples, outbox ordering and replay, unit formatting, HealthKit sleep aggregation (checked against the server's `calculateImportedSleep` cases), and SSE parsing.
- UI tests use XCTest against the existing localhost fixture server (Debug builds only), port the prototype's flows, and add `performAccessibilityAudit()` to each main screen.
- Previews use synthetic data only, never production.
- Before each TestFlight build, do a short device pass: sign-in, log a set offline then reconnect, rest timer on the Lock Screen, a Coach reply, and the app switcher privacy cover.

## Backend changes (shared by web and app)

Each change is small and keeps the website working. They go in the same repository and deploy the usual way.

1. **Client identity and versions.**
   - Accept `X-Client: ios/<version>/<build>`.
   - Add `GET /api/v1/config`, which returns the minimum supported iOS build and feature flags.
   - Teach `requireCurrentCoach` and the voice gate to accept supported native builds.
   - Rule: a native build must keep working for its whole 90-day TestFlight lifetime unless it is blocked on purpose with a structured `426`. The web habit of "refresh to update" does not apply to installed apps.
2. **`POST /api/v1/actions`.** Apply one action from `actionSchema` atomically, with `id` (UUID, idempotent), `action` and `timezone`. Return a receipt, the new revision and an undo handle, using the same machinery as `/api/voice/action`. This replaces the prototype's `/api/mobile/prepare` plus whole-snapshot `PUT`, and makes the offline outbox safe.
3. **Read endpoints.** `GET /api/v1/today?date=` (overview, targets, active workout, next session) and `GET /api/v1/journal` (snapshot with the same food-tag compatibility as the web). These build on `/api/mobile/overview`.
4. **OpenAPI document.**
   - A script (`scripts/openapi.ts`) builds `openapi.json` from the zod schemas with `z.toJSONSchema` and writes it to `ios/Packages/LiftKit/Sources/LiftAPI/`.
   - CI fails if the committed file is out of date or a change breaks the previous version.
   - Add an example-payload test on both sides.
5. **Sessions.** Refresh-token rotation for native sessions. Sign-out and device revocation stay as they are (`/api/devices/revoke`).
6. **Sign in with Apple.** Enable better-auth's Apple provider for ID-token sign-in, with the bundle ID accepted as audience. Store the Apple refresh token so it can be revoked when the account is deleted.
7. **Invitation codes.** Today admission matches the invited email. With Sign in with Apple, a tester can choose Hide My Email, and the relay address will not match. Add single-use invitation codes that bind the invitation to whichever identity accepts it, or let a Google-admitted user link Apple from Settings.
8. **Account deletion.** `DELETE /api/v1/account` deletes the journal, photos, videos, voice records, Coach turns, sessions and invitations, and revokes Apple tokens through Apple's REST API. It offers the existing JSON export first. Required by guideline 5.1.1(v).
9. **APNs.**
   - A device-token table and a registration endpoint.
   - Token-based APNs authentication (a `.p8` key in Railway secrets).
   - The reminder worker sends APNs to native devices and Web Push to browsers, deduplicated so nobody is reminded twice.
   - Live Activity pushes can come later.
10. **HealthKit import.** Let the existing sleep import (`lib/apple-health.ts`) accept samples from a signed-in native session, not only the Shortcut key. Add bodyweight and workout imports with source IDs, so re-delivered HealthKit samples are not double-counted.
11. **Associated domains.** Serve `apple-app-site-association` for the HTTPS sign-in callback and for links into the app. Consider a custom domain before external testing, because changing domains later breaks the association.
12. **Reviewer account.** A single allowlisted account with synthetic data and a narrowly scoped password or code login for App Review. Password login is otherwise disabled in production, and Beta App Review cannot use an invite-only Google account.

## Apple setup checklist (one-time, for you)

1. Add a payment card to the membership (banner on the account page).
2. **Choose the bundle ID. It cannot change once the app record exists.** `app.liftjournal.ios` works, but a reverse-DNS name on a domain you control is conventional.
3. Register the explicit App ID in Certificates, IDs & Profiles with these capabilities: Sign in with Apple, HealthKit (with background delivery), Push Notifications, Associated Domains and App Groups. The widget extension gets its own ID, `<bundle>.widgets`, in the same App Group.
4. Create the app in App Store Connect. The name must be unique on the App Store and can be changed before release; add a SKU.
5. In Xcode → Settings → Accounts, add the developer Apple Account and use automatic signing with the team.
6. Add testers under Users and Access. An individual membership can add up to 50 users, and internal testers must be App Store Connect users. Create an internal TestFlight group.
7. Add an APNs authentication key (`.p8`) and an App Store Connect API key (needed only if uploads run outside Xcode or Xcode Cloud). Store both as Railway or CI secrets, never in Git.
8. Update the privacy policy at `/privacy` for the app: HealthKit, notifications, voice audio to Google, Coach data to OpenRouter's model providers, and deletion.
9. Export compliance: the app only uses HTTPS, so keep `ITSAppUsesNonExemptEncryption = NO`.

## Delivery phases

Sizes are relative (S, M, L), not calendar promises. Each phase ends with something installable.

| Phase | Size | Work | Done when |
| --- | --- | --- | --- |
| 0. Accounts and pipeline | S | Apple checklist above. New Xcode project, xcconfigs, icon, Xcode Cloud workflows, or a scripted archive and upload marked "TestFlight Internal Only". | Build 0.0 is installed from TestFlight on your iPhone. |
| 1. Contract and foundation | M | Backend changes 1–5 and 11. LiftKit packages, generated client, Google sign-in with HTTPS callback, session refresh, cache, outbox, design basics, tab shell. | Contract tests pass on both sides. Sign-in works on the device. Today shows real data and opens offline from cache. |
| 2. Daily loop | L | Today, logging sheets, Train with offline set logging, rest-timer Live Activity, Coach streaming with photos and Undo, Journal, account and export. | Build 0.1. A week of your training, food and sleep is logged from the app only, with the same records on the web. |
| 3. Native value | L | HealthKit, APNs reminders (backend 9 and 10), widgets and App Intents, native voice check-in. | Build 0.2. Sleep appears without opening the app. A reminder logs water from the Lock Screen. A voice check-in in the gym saves without echo. Invited internal testers are using it. |
| 4. Video | M | Capture, compression, background upload, status and replay. | Build 0.3. A 60 fps set uploads with the phone locked, and the review appears. |
| 5. External beta | M | Backend 6–8 and 12. Sign in with Apple, invitation codes, account deletion, AI consent screen, privacy labels, TestFlight test information, reviewer notes. | Beta App Review approves build 1.0, and external testers install from an email invite or public link. |
| 6. App Store | later | Screenshots, store page, privacy nutrition labels, App Review. | Separate decision after the beta. |

## Release process

- **Versions:** `MARKETING_VERSION` follows the table (0.1, 0.2, and so on), and the build number comes from Xcode Cloud's `CI_BUILD_NUMBER`.
- **Branches:** pull requests build and run unit and UI tests in Xcode Cloud; merges to `main` archive and upload. The workflow's TestFlight post-action delivers to the internal group; Xcode Cloud builds are not picked up by the group's automatic distribution. Web CI keeps running the backend and contract checks.
- **Order of deploys:** backend changes deploy before the app build that needs them. A backend change that breaks a TestFlight build still inside its 90 days is a failed release.
- **Build lifetime:** each TestFlight build expires after 90 days, and testers get new builds through the TestFlight app. Internal builds need no review. The first external build of each version is reviewed, and later ones may not be. Up to six builds per 24 hours can be submitted for beta review.
- **Test information:** App Store Connect needs a beta description, what to test, a feedback email and, for external review, sign-in details for the reviewer account.

## Risks and open questions

- **Individual membership and guideline 5.1.1(ix).** Apps "in highly regulated fields … or that require sensitive user information" should be submitted by a legal entity, not an individual. A personal training and food journal is not healthcare, but it does store health data. This does not affect internal TestFlight. Resolve it before external testing or App Store release, by keeping clinical claims out of the app or moving to an organisation membership.
- **Third-party AI.** Guideline 5.1.2(i) now names third-party AI explicitly. Coach sends journal data to OpenRouter's model providers, and voice sends audio to Google. The app needs a clear consent screen before first use, matching privacy labels and a matching policy.
- **Sign-in rules.** Google-only login triggers guideline 4.8, so external testing and the App Store need Sign in with Apple, and Hide My Email breaks email-based invitations (backend change 7).
- **Contract drift.** The prototype's broken Coach shows the risk. The OpenAPI check, versioned native endpoints and the 90-day support rule are the mitigation.
- **Railway domain.** Associated domains and push reminders tie the app to its backend host. Moving from `*.up.railway.app` to a custom domain is easiest before external testers.

Questions for you:

1. Who tests first: only you (internal, no review), or invited friends soon (which pulls phase 5 forward)?
2. Are you happy to start fresh in `ios/` and port the good parts, rather than extending the prototype?
3. Which bundle ID and App Store name do you want?
4. Should HealthKit and push reminders move into 0.1? They are the biggest native gain for the logging drop-off noted in [voice check-in](voice-checkin-2026-09-26.md), but they add capabilities and backend work before the first useful build.

## Sources

- Apple: [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/), [invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/), [add and edit users](https://developer.apple.com/help/app-store-connect/manage-your-team/add-and-edit-users/)
- Apple: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (2.1, 4.2, 4.8, 5.1.1, 5.1.2, 5.1.3), [upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)
- Apple: [WWDC26 SwiftUI guide](https://developer.apple.com/wwdc26/guides/swiftui/), [What's new in SwiftUI (WWDC26)](https://developer.apple.com/videos/play/wwdc2026/269/), [Track workouts with HealthKit on iOS and iPadOS (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/322/), [HKWorkoutSession](https://developer.apple.com/documentation/healthkit/hkworkoutsession)
- Apple: [ActivityKit](https://developer.apple.com/documentation/activitykit), [Live Activities with push](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications), [Xcode Cloud](https://developer.apple.com/xcode-cloud/), [25 Xcode Cloud hours included](https://developer.apple.com/news/?id=ik9z4ll6)
- Swift: [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator), [swift-openapi-urlsession](https://swiftpackageindex.com/apple/swift-openapi-urlsession)
- Better Auth: [Apple provider and ID-token sign-in](https://better-auth.com/docs/authentication/apple)
- iOS 27 release and device support: [AppleInsider](https://appleinsider.com/articles/26/09/09/ios-27-arrives-on-september-14-heres-what-youll-get)
