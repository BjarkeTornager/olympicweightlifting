# Website testing and direct App Store release

Reviewed 6 September 2026 against Apple's current documentation and this repository.

**Owner decision, 6 September 2026: use the website for testing now, then release the native app directly through the App Store when ready. TestFlight and Ad Hoc testing are not planned.**

Test the current app at https://lift-journal-production.up.railway.app using the existing owner/invitation access controls. App Store publishing is deferred; this decision does not initiate enrollment or a submission.

The native SwiftUI app already exists in `LiftJournal.xcodeproj`, targets iOS 18+, and connects to the existing Railway backend. A web-to-native rewrite is unnecessary. No signed installation, Apple enrollment, App Store Connect upload or approval has been completed. Website testing covers shared features and backend behavior; native device acceptance remains necessary before release.

## Distribution options for reference

| Route | Best use | Requirements and tradeoffs |
| --- | --- | --- |
| Free Xcode Personal Team | Trying the app on your own iPhone now | Apple Account, Mac and connected phone. Provisioning expires after seven days; rebuild/reinstall as needed. See [local installation](README.md#install-on-your-own-iphone-with-a-free-apple-account). |
| TestFlight | Friends testing remotely | Paid membership, signed build uploaded to App Store Connect, and beta review for the first external build. Testers install Apple's TestFlight app and accept an email invitation. Builds last up to 90 days. |
| Ad Hoc | A few known devices when a direct install is useful | Paid membership and registration of each device identifier. Up to 100 iPhones per membership year. More installation and update administration than TestFlight. |
| App Store — planned | A stable native release after website testing | Paid membership, native device acceptance, store metadata and App Review. |

The Apple Developer Program costs **99 USD per year, or local currency where available**. Testers do not need a developer membership. Individual enrollment lists your legal name as seller; organization enrollment requires an eligible legal entity and D-U-N-S number. Choose the intended seller before enrolling. [Membership comparison](https://developer.apple.com/support/compare-memberships/), [enrollment](https://developer.apple.com/help/account/membership/program-enrollment/).

TestFlight supports up to 10,000 external testers. Use external email invitations for friends; internal testing grants access through App Store Connect roles and is intended for the development team. [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers), [Ad Hoc devices](https://developer.apple.com/help/account/devices/devices-overview/).

## What this app needs before App Store submission

- **Signing:** enroll, select the paid team in Xcode, register a unique bundle ID and create its App Store Connect record. The current bundle ID `app.liftjournal.ios` is a project setting, not a confirmed Apple registration.
- **Real-device acceptance:** verify Google handoff, camera, keyboard, background privacy and saving/reopening records. Simulator tests and an unsigned device build have passed; physical-device acceptance is outstanding.
- **Login decision:** the current app offers Google only. Apple's guideline 4.8 generally requires an equivalent privacy-preserving alternative, commonly Sign in with Apple. No clear exemption is apparent for this health journal. Resolve this before submission while preserving invitations and account isolation.
- **Account deletion:** implement an in-app account-deletion flow. Deleting individual journal entries and signing out do not delete the account.
- **Seller eligibility:** confirm the appropriate enrollment with Apple before paying. Guideline 5.1.1(ix) addresses legal-entity submission for apps requiring sensitive information; this app stores health records, so individual enrollment should not be assumed suitable.
- **Review package:** complete privacy disclosures, store information and reviewer access using synthetic data. A privacy manifest and app icon exist, but they do not complete App Store Connect submission. [Apple guidelines: 2.1, 4.8 and 5.1.1](https://developer.apple.com/app-store/review/guidelines/).

## Planned release sequence

1. Continue testing and improving the Railway website with invited users.
2. When ready for a native release, resolve enrollment and finish the readiness items above, including acceptance on a physical iPhone.
3. Archive and upload a signed release build to App Store Connect, complete the store listing and submit it for App Review.
4. Release through the App Store after approval. App installation does not grant journal access or access to another user's records; retain invitation admission and account isolation.

EU direct website distribution has additional eligibility, notarization and operating obligations. It is not the simplest starting route for this project. [Apple Web Distribution](https://developer.apple.com/support/web-distribution-eu/).

For an interim Ad Hoc trial, register the testers' device identifiers, export an archive signed for those devices, and install it on those phones. This uses device provisioning rather than a TestFlight submission, but requires more manual installation and update work. [Ad Hoc profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile), [testing a release build](https://developer.apple.com/documentation/xcode/testing-a-release-build).
