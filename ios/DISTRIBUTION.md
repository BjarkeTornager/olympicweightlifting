# Getting Lift Journal onto testers' iPhones

Reviewed 6 September 2026 against Apple's current documentation and this repository.

**Recommendation: use TestFlight for the first group of external testers.** The native SwiftUI app already exists in `LiftJournal.xcodeproj`, targets iOS 18+, and connects to the existing Railway backend. A web-to-native rewrite is unnecessary. No signed installation, Apple enrollment, App Store Connect upload or approval has been completed.

## Options

| Route | Best use | Requirements and tradeoffs |
| --- | --- | --- |
| Free Xcode Personal Team | Trying the app on your own iPhone now | Apple Account, Mac and connected phone. Provisioning expires after seven days; rebuild/reinstall as needed. See [local installation](README.md#install-on-your-own-iphone-with-a-free-apple-account). |
| TestFlight | Friends testing remotely | Paid membership, signed build uploaded to App Store Connect, and beta review for the first external build. Testers install Apple's TestFlight app and accept an email invitation. Builds last up to 90 days. |
| Ad Hoc | A few known devices when a direct install is useful | Paid membership and registration of each device identifier. Up to 100 iPhones per membership year. More installation and update administration than TestFlight. |
| App Store | A stable release after testing | Paid membership, store metadata and App Review. This can follow TestFlight using the same native project. |

The Apple Developer Program costs **99 USD per year, or local currency where available**. Testers do not need a developer membership. Individual enrollment lists your legal name as seller; organization enrollment requires an eligible legal entity and D-U-N-S number. Choose the intended seller before enrolling. [Membership comparison](https://developer.apple.com/support/compare-memberships/), [enrollment](https://developer.apple.com/help/account/membership/program-enrollment/).

TestFlight supports up to 10,000 external testers. Use external email invitations for friends; internal testing grants access through App Store Connect roles and is intended for the development team. [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers), [Ad Hoc devices](https://developer.apple.com/help/account/devices/devices-overview/).

## What this app needs before external TestFlight

- **Signing:** enroll, select the paid team in Xcode, register a unique bundle ID and create its App Store Connect record. The current bundle ID `app.liftjournal.ios` is a project setting, not a confirmed Apple registration.
- **Real-device acceptance:** verify Google handoff, camera, keyboard, background privacy and saving/reopening records. Simulator tests and an unsigned device build have passed; physical-device acceptance is outstanding.
- **Login decision:** the current app offers Google only. Apple's guideline 4.8 generally requires an equivalent privacy-preserving alternative, commonly Sign in with Apple. No clear exemption is apparent for this health journal. Resolve this before submission while preserving invitations and account isolation.
- **Account deletion:** implement an in-app account-deletion flow. Deleting individual journal entries and signing out do not delete the account.
- **Seller eligibility:** confirm the appropriate enrollment with Apple before paying. Guideline 5.1.1(ix) addresses legal-entity submission for apps requiring sensitive information; this app stores health records, so individual enrollment should not be assumed suitable.
- **Review package:** complete privacy disclosures, beta information and reviewer access using synthetic data. A privacy manifest and app icon exist, but they do not complete App Store Connect submission. TestFlight beta submissions must also comply with App Review Guidelines. [Apple guidelines: 2.1, 2.2, 4.8 and 5.1.1](https://developer.apple.com/app-store/review/guidelines/).

## First beta sequence

1. Enroll and finish the readiness items above.
2. In Xcode, select a generic iOS device, **Product → Archive**, then distribute to **App Store Connect**. Use the distribution option that permits external TestFlight testing, rather than an internal-only upload.
3. Create the testing groups, supply beta review information, and submit the first external build.
4. After approval, invite the initial testers by email. Separately invite each person's Google account inside Lift Journal. Installing a TestFlight build does not grant journal access or access to another user's records.
5. Upload incremented builds for updates and before the previous build's 90-day expiry. [Apple's beta tutorial](https://developer.apple.com/tutorials/develop-in-swift/test-your-beta-app).

EU direct website distribution has additional eligibility, notarization and operating obligations. It is not the simplest starting route for this project. [Apple Web Distribution](https://developer.apple.com/support/web-distribution-eu/).

For an interim Ad Hoc trial, register the testers' device identifiers, export an archive signed for those devices, and install it on those phones. This uses device provisioning rather than a TestFlight submission, but requires more manual installation and update work. [Ad Hoc profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile), [testing a release build](https://developer.apple.com/documentation/xcode/testing-a-release-build).
