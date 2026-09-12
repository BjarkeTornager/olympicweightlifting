# Daily Coach and health journal

The latest [Coach experience release](coach-experience-deployment-2026-09-06.md) is deployed and verified on Railway.

Coach opens directly into **Conversation**, with the latest exchange and a message box that stays available while the chat scrolls. **Today** opens the daily training, nutrition and recovery overview. Switching these views preserves the current message and attached images.

Use **Log food** or **Log sleep** to prepare a message, **+** to attach/take images and change automatic tagging, and **Coach options (···)** for health history, image categories, programmes, privacy and clearing chat. The last six exchanges appear first; **Earlier messages** reveals older saved exchanges and **Latest message** returns to the newest one. **Review** jumps to pending, unexpired proposals. Saved and undone entries collapse into summaries; expand one to inspect its details, open the journal or use an available undo.

Replies use readable paragraphs, headings, real numbered/bulleted lists, bold and italic emphasis. The daily overview retains the navy, pale green and neutral palette and a week strip of actual check-in, food and training entries. Missing entries remain missing; there is no invented health score.

**Plan my day** in Today sends an explicit request to the configured assistant when the composer is empty. If a message or attachment is already being prepared, it adds the request to that draft for review before sending. Its health overview tool retrieves the authenticated user's check-ins, seven days of training, current food totals and chosen nutrition targets. The assistant explains at most three priorities, connects suggestions to recorded observations and calls out missing information. This is an on-demand conversation; it does not run in the background or send notifications. The overview's “good next step” cards use deterministic journal rules and are labelled as starting points; they are not presented as an AI assessment.

## Cardio and movement

The journal also supports running, cycling, walking, swimming, rowing, hiking and other cardio activities. **Train → Cardio & movement** opens logging and activity history. Coach can prepare activities from descriptions or categorized activity screenshots, apply reviewed corrections and build tables/charts from private records. The daily overview includes strength and cardio in training totals. See [cardio tracking](cardio.md) for measurements, privacy and verification.

## Daily check-ins

### Log sleep with Coach

The sleep flow is [deployed and verified on Railway](sleep-deployment-2026-09-06.md).

Tell Coach “I slept 7 hours 47 minutes last night,” or attach a sleep screenshot and ask it to log the night. **Log sleep** beside the message box prepares the request without sending it or replacing typed text. The Sleep card in Coach → Today and **Log sleep with Coach** in Health open the sleep flow. Sleep images in the library offer both **Read sleep image** for explanation and **Log sleep with Coach** for a save proposal.

Coach reads the existing check-in before preparing a merged review. The night belongs to its wake-up date: “last night” uses today in the athlete's timezone, while a clear screenshot date takes precedence over upload date. Time asleep is distinct from time in bed and weekly averages. Unclear dates or durations require clarification. Hours and minutes convert to decimal hours for storage and display as hours/minutes in the review and history. Sleep corrections replace that date's value; other measurements and notes remain intact. The manual form accepts minute-precision stored values so editing water later does not fail step validation. Saves require the existing review action and retain idempotency, conflict handling, undo, account ownership and backup support.

`scripts/sleep-smoke.ts` verifies the real configured model using a disposable account and synthetic Apple Health-style pixels. On 6 September 2026 it passed a first-person sleep report, hours/minutes conversion, local “last night,” review before save, idempotent retry, a screenshot with different time-asleep/time-in-bed/weekly-average values and an older date, a same-day correction, and clarification of an undated weekly report. It confirmed existing water/bodyweight/notes were preserved and no food entries were created. This is screenshot interpretation, not an Apple Health connection or background sleep tracking.

The check-in form and the `record_checkin` agent action support sleep hours, energy (1–5), muscle soreness (1–5), daily water total in ml, bodyweight in kg and notes. There is one check-in per date. Fields are optional; unknown values are null, with explicit zero preserved for sleep/water. Agent changes require reading the date's existing context, reviewing the merged entry and pressing Save. Patches preserve fields that were not supplied, and use the journal's revision conflict and idempotent save/undo mechanism. A check-in weight does not overwrite profile settings or training loads.

Health history is accessible from Coach and the desktop navigation. It shows 14 days of reported sleep, sample counts, the latest weight in that period and an editable/deletable history with earlier entries. Check-ins are stored inside the account journal snapshot, synced and included in JSON backups. Legacy snapshots and offline copies gain an empty health section on read. Conflicting imported dates stop for review rather than replacing entries. No extra SQL migration beyond the food feature is needed.

## Scope and privacy

All records are self-reported. The app has no wearable feeds, diagnostic tools, measured readiness score or calorie expenditure calculation. The coach supports everyday habits and training choices, avoids restrictive calorie prescriptions and compensatory exercise, and directs medical concerns to appropriate care. Suggestions based on low energy or high soreness are explicitly tied to that day's self-report. Data from yesterday does not silently become today's condition. Relevant health entries are sent to the selected provider when the user asks for guidance; the updated privacy page explains this.

General reference material is limited to [CDC sleep guidance](https://www.cdc.gov/sleep/about/index.html) and [NHS adult activity guidance](https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-for-adults-aged-19-to-64/). Population guidance does not become an automatic personal target.

Assistant text is rendered as escaped React text with a small allowlist of headings, emphasis and lists. HTML, images and model-supplied links are never executed.

## Verification

`npm run check:production` checks domain validation, account isolation, review-before-save, retries, partial updates, undo, backup conflicts and the response renderer. `npm run test:browser` covers daily check-ins, history, contextual priorities, read-only daily plans, accessibility and responsive layout across Chromium, Firefox and WebKit. `scripts/health-smoke.ts` is an opt-in real-provider check with a synthetic account in a disposable `_test` database; it never uses production health data.

The real OpenRouter/Gemini test on 6 September 2026 passed natural-language health entry, context lookup, a reviewed save, adding water to an existing daily total, preservation of sleep/energy/soreness/weight, and read-only guidance that acknowledged missing food/training records. Synthetic data was removed afterwards. This verifies the product integration, not clinical effectiveness.

These changes are now deployed to the hosted pilot. See the [food and health release record](food-health-deployment-2026-09-06.md) for deployment and live verification.

Final local verification: production build, typecheck and lint passed; 23 progression tests, 29 domain/auth/database/provider/rendering tests and all 39 browser tests passed (91 tests total). The browser suite includes 320–1440 px widths and WCAG A/AA checks. Desktop and phone screenshots use synthetic data. Production was subsequently deployed and checked as recorded below.
