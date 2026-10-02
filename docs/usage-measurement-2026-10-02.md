# Usage measurement

2 October 2026. The product principles (docs/product-principles.md) say features are kept, merged or removed on evidence. This release collects that evidence without collecting anyone's content.

## What is counted

One row per account, feature and UTC day in `feature_use`, holding only a count. Feature names match `^[a-z0-9_.:-]{1,80}$`; anything else is ignored. The rows are deleted with the account.

| Feature name | Counted when |
|---|---|
| `coach.message`, `coach.photo` | A new typed Coach message, and one with photos |
| `coach.tool.<tool>` | Coach used a tool successfully |
| `coach.change.<kind>` | Coach prepared or saved a change of that kind (each entry of a bundle) |
| `voice.call.<provider>`, `voice.purpose.<purpose>`, `voice.language.<language>` | A voice call started (a resumed Google call isn't counted again) |
| `voice.tool.<tool>`, `voice.photo.elevenlabs` | A voice tool succeeded; a photo was shown to ElevenLabs |
| `app.<kind>` | The iPhone app saved a change of that kind |
| `web.journal_save` | The website saved the journal |
| `health.sync.app`, `health.sync.shortcut`, `health.shortcut_connect` | Apple Health imports, from the app or the Shortcut |
| `image.upload`, `video.upload` | Uploads |
| `reminders.web_push`, `invitation.send` | Web push reminders turned on; an invitation sent |

`countUse` never delays or fails the request: the write runs in the background, and a failure logs only the feature name and PostgreSQL error code.

## The owner's usage page

Settings › Usage on the website, shown only to `OWNER_EMAIL`; `GET /api/owner/usage` refuses everyone else. It shows totals and averages only:

- People: total, active in the last 7 and 28 days. Active means a recorded day or any counted use.
- **Recorded days per active person, by week** (Monday to Sunday, UTC), for eight weeks. "Full days" is the main measure: sleep, food and movement all recorded. "Any record" counts days with at least one.
- **Week-4 retention** for the last twelve weeks of sign-ups: how many recorded or used something on days 21–27 after joining.
- **Features in the last 28 days:** people, uses and the last day used.

Recorded days come from the journal: sleep is a check-in with sleep hours; food is a meal; movement is a workout, an activity, or Apple Health steps above zero. Drinks, supplements, other check-ins and body fat count towards "any record" but not full days. PostgreSQL projects the journals down to dates, so no journal content leaves the database, and nothing is stored beyond the request.

## Privacy

- The privacy policy has a new section, "How we measure use", and lists usage counts among what account deletion removes.
- The iPhone app's privacy manifest declares Product Interaction data, linked to the account, not tracking, for analytics. **The App Store privacy answers need the same when the app is submitted for review.**
- Nothing is sent to an analytics service.

## Not included

Screens the iPhone app opens aren't counted, because only server requests are. If a decision needs screen views (for example whether anyone opens Images), that's a separate, small change.
