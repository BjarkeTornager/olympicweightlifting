# External TestFlight beta (public link and QR code)

26 September 2026. This lets testers join the iPhone app beta from a TestFlight public link or a QR code of it, without being App Store Connect users and without an email invitation. Access to a journal is still limited to invited Google accounts.

## What changed in the code

| Change | Why |
| --- | --- |
| `ios/scripts/ExportOptions.plist` no longer marks uploads **Internal Only** | An internal-only build can never be added to an external group. Internal testers still get every build. |
| App Review sign-in on `/mobile` (`APP_REVIEW_PASSCODE`, `lib/review.ts`, `POST /api/mobile/review`) | Apple's reviewer cannot use an invite-only Google account. The passcode opens one fixed, empty account (`app-review@lift-journal.invalid`) through the usual PKCE callback, so the app itself is unchanged. The form appears only when the passcode is set (20 or more characters), and removing it also ends the account's sessions. |
| Account › Delete account (`DELETE /api/account`) | Guideline 5.1.1(v). It deletes the user row, which cascades to the journal, workouts, photos, videos, voice transcripts, Coach turns, Apple Health imports, reminders, sessions and sign-in accounts, and it removes the member's invitation. The owner account is refused because it holds every invitation. |
| AI permission screen before Coach (`AIConsent`), toggle in Account | Guideline 5.1.2(i): explicit consent before personal data, including Apple Health data, goes to third-party AI. It resets on sign-out. |
| Privacy policy | Covers the iPhone app's Apple Health access, AI permission, voice check-ins (audio to Google's Gemini Live API) and in-app deletion. |

Sign in with Apple and invitation codes (plan items 6 and 7) are **not** included; see the risks below.

## Steps for you

1. **Merge the PR.** Railway deploys `main` after CI.
2. **Set the review passcode** on the Railway service: `APP_REVIEW_PASSCODE` = the output of `openssl rand -base64 24`. Railway redeploys when a variable changes.
3. **Invite each tester's Google account** on the website (Settings › Invitations). A tester can use any Google account; it doesn't have to match their Apple Account.
4. **Upload a build** from `main`: `ios/scripts/testflight.sh`.
5. **App Store Connect › TestFlight › Test Information**, using the text below:
   - Beta App Description, Feedback Email, Privacy Policy URL `https://lift-journal-production.up.railway.app/privacy`.
   - Beta App Review Information: contact details; tick *Sign-in required*; Username `app-review@lift-journal.invalid`; Password = the passcode; Review Notes.
6. **External Testing › +** to create a group (for example "Beta"), add the build and **Submit for Review**. Export compliance is already answered in `Info.plist`.
7. **After approval:** open the group › **Public Link** › Enable. Optionally set a tester limit. Copy the `https://testflight.apple.com/join/…` link and make a QR code of it.
8. **Testers:** install TestFlight from the App Store, then open the link or scan the QR code on the iPhone › Accept › Install. TestFlight uses the Apple Account signed in on that phone, so no email is needed. In Lift Journal, tap Continue with Google and choose the invited Google account.

Each new build has to be added to the external group. The first build of each new version (for example 0.2) goes through Beta App Review again; later builds of an approved version usually don't.

## Text for App Store Connect

**Beta App Description**

> Lift Journal is a private training journal for weightlifters. Log workouts and sets, meals, water, sleep and daily check-ins; import sleep, heart rate and workouts from Apple Health; and ask Coach, an AI assistant, about your training. The beta is invitation-only: sign in with the Google account you were invited with.

**What to Test**

> Log water and a check-in on Today, ask Coach about today's training, connect Apple Health from Account, and check that entries appear in Journal. Please report anything confusing or broken with TestFlight's screenshot feedback.

**Review Notes**

> Lift Journal is invitation-only; members sign in with an invited Google account. For review, please use the App Review sign-in:
> 1. Tap "Continue with Google". A Lift Journal web page opens.
> 2. Tap "App Review sign-in" below the Google button.
> 3. Enter the password above as the passcode and tap "Sign in for App Review".
>
> The review account starts with an empty journal. Coach uses third-party AI and asks for permission before anything is sent. Apple Health access is read-only. Account (toolbar button) › Delete account permanently deletes the account; signing in with the passcode again creates a fresh one.

## Risks at Beta App Review

- **Guideline 4.8 (login services).** Members sign in with Google only. Beta review is usually lighter than App Review, but it can still ask for Sign in with Apple. If it does, add Sign in with Apple with invitation codes (plan backend items 6 and 7), because Hide My Email addresses won't match an emailed invitation.
- **Guideline 5.1.1(ix).** The app handles health data under an individual membership. Keep clinical claims out of the listing and the notes.
- **Voice check-ins** (in progress on another branch) must check `AIConsent` before streaming audio, before a build with voice goes to external testers.
