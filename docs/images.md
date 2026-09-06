# Private image library

Open **Images & screenshots** near the top of Coach, or **Images** in the desktop navigation. Food and Health also link to the full library. Uploads are stored once per account and organised into **Food, Sleep, Activity, Health, Other, or Needs review**. Tags describe the subject, format and visibly identifiable source app, such as Apple Health.

With **Tag automatically** enabled, a new upload is sent to the configured image-capable assistant provider for one classification request. The upload control and privacy page disclose this. Turn it off to save without provider processing, then choose a category manually. Explicit **Retag automatically** sends an existing image for a new classification. Opening a gallery does not send images to a provider. This is screenshot analysis, not a connection to Apple Health or another app.

The classifier uses pixels without the user-supplied label or journal contents. Its only output tool is a validated category/confidence/tags object; it has no journal-write tools. Non-high-confidence results stay in Needs review. Timeouts, unavailable providers and malformed responses keep the original upload; new images stay out of Food. Failed retagging retains the previous category and flags the failed attempt. Tags are bounded suggestions rather than measurements or diagnoses.

**Edit category & tags** corrects mistakes. Updates check a per-image version, and explicit edits win over in-flight model results. A photo linked to a meal must be unlinked in Food and synced before moving to another category. This prevents a concurrent meal save from retaining a non-food attachment. Download images individually; **Export image catalog** downloads all owned image metadata, categories and tags as JSON. Journal JSON exports remain separate and do not contain image bytes or category metadata. Operational PostgreSQL backups include both.

## Keeping food and health separate

Food queries only Food images. Health displays Sleep, Activity and Health images. The general library includes all categories and supports category filters and label/tag/date search. An Apple Health sleep screenshot uploaded from Food is saved in Sleep and can be opened from Health or Images; it is not appended to the meal gallery. Needs review and Other images are visible in the general library.

Coach reads attachment metadata before choosing a default prompt. Food offers meal estimation; Sleep opens a screenshot-reading request without asking to save a meal or check-in. Other categories get a neutral review prompt. The assistant can prepare a requested health check-in from clearly visible values after reading existing health context, but the user still reviews and saves it. Upload dates do not become sleep dates automatically. Server-side meal writes and assistant proposals reject image links outside Food, including stale proposals saved after recategorisation.

## Storage and migration

Migration `0004_last_professor_monster` adds category, classification and version columns plus an account/category index to the existing `food_photos` table. The physical table and `meal_date` column retain their legacy names so stored bytes and references do not move. New `/api/images` routes provide a generic catalog, private bytes/metadata reads, versioned category edits, deletion and explicit reclassification. Access requires the authenticated owner and matching account header; mutations also require a trusted origin. Responses stay private and uncached.

Existing unlinked uploads start in Needs review. Existing explicit meal links retain Food for compatibility and show a review marker; migration does not inspect or transmit archived images. Legacy upload clients do not opt into automatic provider processing. Their new images remain in Needs review, and the old food-only upload endpoint asks them to refresh to Images. All categories share the existing account quota and ownership constraints.

## Verification

Local production checks and all three browser suites passed on 6 September 2026: 23 progression checks, 32 domain/database/provider tests and 45 browser workflows (100 checks total), plus type checking, lint and the production build.

Unit/database tests cover uncertain and malformed model output, durable uploads when tagging fails, idempotent upload retries, foreign-account denial before inference, version conflicts, manual edits during inference, food-only meal references, and reviewed health entries from sleep attachments. Browser checks cover uploading a sleep image from Food, finding it in Health, a neutral sleep conversation, category correction, provider failure, private uploads, catalog export, reload, accessibility and 320–1440 px widths across Chromium, WebKit and Firefox.

The opt-in `scripts/images-smoke.ts` uses synthetic pixels and a disposable `_test` database. On 6 September 2026, the real OpenRouter/Gemini model correctly classified an Apple Health sleep report, a nutrition label, an Apple Fitness workout summary containing burned calories, and an unrelated stationery receipt. Misleading upload labels did not change the results. Food contained only the nutrition image; tagging created no meal or health entries. Test accounts and images were removed afterwards. This verifies the integration and representative examples, not perfect classification of every upload.
