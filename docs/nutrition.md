# Food journal

Open **Food** in the navigation. Add a meal manually, or tell **Coach** what you ate. Coach accepts up to four attached meal photos per message and prepares an itemised review card with portions, calories, protein, carbohydrates, fat and assumptions. Ask for corrections before saving, or edit the saved meal in Food. Estimates are explicitly labelled and are not a food-database or clinical measurement.

Food shows totals for the selected date, optional daily targets, a maintain/lose/gain preference and a seven-day summary of logged days. Targets are user chosen; changing the goal label does not calculate or impose a calorie prescription. Missing or partially logged days are not treated as complete intake.

## Accounts, photos and backups

Meals and targets live in the account journal JSONB snapshot, so normal revision conflicts, offline drafts, user isolation, journal export/import and undo apply. Existing journals and local copies gain an empty nutrition section on read. Imported meal ID collisions fail explicitly instead of replacing entries. Image references are validated against the authenticated owner during every cloud journal write. An import from another account retains meal data locally but requires removing unavailable image links in Food before syncing; it cannot read another account's files.

Photos require a signed-in account and internet. Camera/file uploads are resized in-browser, then decoded and re-encoded server-side with Sharp. The server accepts bounded JPEG/PNG/WebP input, caps decoded pixels, normalises orientation and strips EXIF/GPS metadata. Processed JPEG bytes and date/label metadata live in `food_photos` in PostgreSQL, with a composite owner/photo key and cascading account deletion. There are no public image URLs. Reads and writes require a current session and matching account header; writes also validate the request origin. API responses are private and no-store; blobs are revoked on component unmount and the service worker never caches API routes.

The searchable catalog retains uploads independently of chat and meals. Link an existing photo by selecting **Estimate meal**. To delete a linked photo, remove its links in the meal editor and sync first. Download individual images from photo cards. Journal JSON exports include all meals, targets and photo references, but not photo bytes or conversation. PostgreSQL operational backups include the photo table and its bytes. For the private pilot, each account is limited to 1,000 photos or 250 MB with upload rate limiting; review database size and backup duration before expanding the pilot or increasing limits. A future object-store migration can preserve catalog IDs.

## Provider and deployment

Apply migration `0003_sloppy_talon` using the existing release migration command before serving this code. It adds the photo table and attachment IDs on assistant turns without rewriting training history. The standalone build includes Sharp as a direct pinned dependency.

The configured model must support **both images and function tools**. OpenRouter receives base64 image content blocks with the existing ZDR/data-collection restrictions; Ollama receives an `images` array. Only photos attached to the current message are sent as visual context. Previous proposal details remain available for corrections, but prior chat images and the catalog are not automatically sent. Provider errors keep uploaded photos in the library and do not commit a meal. No new API key or storage service is required.

Verification uses synthetic meal records and generated image pixels only, with a disposable `_test` database. Production data is not used as a test fixture. Run `npm run check:production`, `npm run build` and `npm run test:browser`. The opt-in `scripts/nutrition-smoke.ts` checks the real provider using synthetic data; it is not part of normal CI.

Protocol references: [OpenRouter image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding) and [Ollama vision](https://docs.ollama.com/capabilities/vision).

## Verified locally · 6 September 2026

- Fast-forward pull on `codex/agent-first-journal`: already up to date at `c29f5b2` before these changes.
- Nutrition migration applied successfully to the disposable local test database; no production migration or deployment performed.
- `npm run check:production`: typecheck, lint, 23 legacy progression tests and 24 domain/auth/database/provider tests passed with no skips.
- `npm run build`: standalone production bundle and public offline shell completed.
- `npm run test:browser`: all 33 checks passed across Chromium, WebKit and Firefox, including food entry/correction/targets, older local copies, a physically disconnected test origin, photo upload/review/save, accessibility and mobile overflow.
- Real OpenRouter/Gemini smoke: text meal estimation, synthetic photo-label reading (180 kcal and 20 g protein), private photo linkage, review-before-save, persistence and undo passed. Synthetic accounts and photos were removed afterwards. This verifies the integration, not the accuracy of estimates from real plates.

Food is now available on the hosted pilot. See the [food and health release record](food-health-deployment-2026-09-06.md) for the deployed source, migration and live verification.
