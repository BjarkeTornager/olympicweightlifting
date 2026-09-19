# Less manual tracking, while staying web-only

The user reports forgetting food, sleep, and workouts because recording them requires too much effort. They already use Apple Watch / Apple Health and want to remain web-only without an Apple developer account. The user subsequently authorized this recommendation; [implementation and setup notes](low-effort-tracking-implementation-2026-09-19.md) describe the new work. These features are separate from the previously deployed Train interface release.

## Recommended next changes

1. Put a single quick-capture entry point on the opening screen: take a food photo, dictate a short report using the iPhone keyboard, or repeat a saved meal. Keep the existing save-first estimate and Undo behavior. A usual meal is a suggestion until the person reports eating it.
2. Add one optional daily catch-up notification, at the user's chosen local time, that opens capture directly. Only prompt for missing records; do not turn absent logs into zero intake or missed training. Ask for notification permission after the person enables reminders. Provide an equally simple off switch.
3. Prototype an iPhone Shortcut that reads sleep samples and sends a small authenticated import to the website. Test it on the user's device before extending to workout summaries or relying on automatic triggers. A website cannot query the phone's HealthKit store directly.

The current website already has a standalone web manifest and service worker. Coach can already save food, sleep, cardio, and reported performed sets from ordinary messages, including multiple entries from one message. Follow-ups currently appear on visits; there is no background notification service.

## What the Health bridge must prove

- Shortcuts can retrieve the required sample types on the user's iOS version and with their permissions. Apple documents Find Health Samples and HTTP POST/JSON, but that does not prove the complete workflow on this phone.
- Sleep import handles overlapping sources, sleep stages, midnight boundaries, and the user's time zone without double-counting. Import measured sleep only, retaining source and time range.
- Re-running or retrying the shortcut does not duplicate entries; corrected samples and manual corrections have explicit rules.
- Use a revocable per-account credential with limited import scope, a bounded payload, and clear consent. Do not embed a website administrator key or depend on copying browser cookies.
- Handle unavailable data and failures visibly. Health data may be inaccessible while the phone is locked; a time-based trigger alone does not guarantee a successful morning sync. Show last successful sync and offer an unlocked one-tap retry.
- Verify workout data availability separately. A workout-end automation trigger is not proof that full workout details are readable. An imported activity summary must not complete planned lifting sets or invent weights/reps.

## Success criteria

Measure actual steps to log a meal and how often the user records the day without opening several pages. For the bridge, compare imported sleep with Apple Health, retry twice without duplicates, and test locked/unlocked execution and delayed Watch sync. For reminders, test delivery to an installed Home Screen web app, time-zone changes, opt-out, and suppression when nothing relevant is missing.

## Primary sources checked

- [WebKit: Web Push for Home Screen web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): user-granted notifications work on iPhone Home Screen web apps without Apple Developer Program membership.
- [Apple: Find and Filter actions](https://support.apple.com/en-jo/guide/shortcuts/apd3c845e881/ios): Shortcuts includes Find Health Samples.
- [Apple: Make API requests from Shortcuts](https://support.apple.com/en-euro/guide/shortcuts/apd58d46713f/ios): Get Contents of URL supports POST and JSON request bodies.
- [Apple: Automation event triggers](https://support.apple.com/en-om/guide/shortcuts/apd932ff833f/ios): time, sleep, and Apple Watch workout events can trigger shortcuts.
- [Apple: Health data unavailable while locked](https://developer.apple.com/documentation/healthkit/hkerror/code/errordatabaseinaccessible): encrypted Health data can be inaccessible when querying from a locked phone.
