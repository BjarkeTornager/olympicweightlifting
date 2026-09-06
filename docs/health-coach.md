# Daily Coach and health journal

Coach now opens with a daily overview for training, nutrition and recovery. The interface uses a shared navy, pale green and neutral palette, consistent cards, measured typography and layouts for phone and desktop. A week strip shows actual check-in, food and training entries; missing entries stay visibly missing. There is no invented health score.

**Plan my day** sends an explicit request to the configured assistant. Its health overview tool retrieves the authenticated user's check-ins, seven days of training, current food totals and chosen nutrition targets. The assistant explains at most three priorities, connects suggestions to recorded observations and calls out missing information. This is an on-demand conversation; it does not run in the background or send notifications. The overview's “good next step” cards use deterministic journal rules and are labelled as starting points; they are not presented as an AI assessment.

## Daily check-ins

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
