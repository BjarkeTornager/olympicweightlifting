# Private photo retrieval in Coach

Coach can now answer **“Show me images of what I ate today”** with actual photos in the website conversation. The old metadata-only limitation and instructions to re-upload images for inspection have been removed.

## Behaviour

- Coach first reads the requested meals and uses their linked image IDs. This respects the meal's date even when a photo's library date differs. If meals have no linked photos, it can find food-category library photos for the requested dates and explain that those are not confirmed meal records.
- `show_images` returns a validated `photo_gallery` through the existing AG-UI visual event and persisted conversation response. It displays up to eight distinct images in one gallery, with no public URLs or arbitrary image markup.
- Photos have current labels, library dates and categories, and open in a larger viewer with a download link. The composer remains reachable on phones. Old galleries reload from the private library; unavailable photos show a placeholder, and renamed images use their current labels.
- `inspect_images` retrieves selected saved images when the person asks Coach to read or analyse their contents. Up to four distinct images, including current attachments, can be inspected per message. The real-model check read the time asleep from a saved synthetic screenshot without another upload.

Displaying a gallery only retrieves images to the user's browser. It does not send pixels to the model. Asking for visual analysis sends the selected pixels and metadata to the configured model provider for that turn. The options disclosure and privacy page explain this distinction.

## Boundaries

Both tools recheck ownership against the authenticated account. A mixed request containing another account's ID fails before emitting a gallery or adding image pixels to model context. Invalid/deleted IDs produce the same unavailable result. The gallery schema accepts only bounded UUID references, never external URLs, HTML or base64. The generic `show_visual` tool cannot construct a gallery and bypass those checks.

The browser fetches current metadata and image bytes through the existing private, no-store image endpoint with `X-Journal-Account`. Old response data never grants image access. Image blob state is keyed by account and image ID; requests abort and object URLs are revoked on unmount. Normal sign-in, invitation and account isolation remain in force.

Retrieved pixels live only in the current model request context. They are not copied into stored conversations, AG-UI events or journal records. Gallery references remain subject to the existing chat retention/clear controls. Viewing or inspecting an image creates no meal, sleep or workout record. Existing review-before-save rules and meal-photo attachment checks remain in force.

## Verification

Disposable database tests cover food-category retrieval, owned gallery persistence, cross-account and deleted-photo rejection, all-or-nothing image retrieval, duplicate inspection, the four-image limit, and no image pixels in chat storage or browser events. Browser tests exercise AG-UI, reload, current labels, deleted photos, account switching, enlargement, authenticated blob downloads, accessibility and 320–1440px layouts in Chromium, WebKit and Firefox. Mobile gallery and viewer screenshots were inspected.

The optional real-model smoke test uses only synthetic images in a disposable `_test` account, then deletes the account:

```sh
AGENT_PROVIDER=openrouter AGENT_MODEL=google/gemini-3.8-flash node --import tsx scripts/coach-photos-smoke.ts
```

On 7 September 2026 it displayed the photo linked to a meal logged today despite an earlier assistant denial and the image having yesterday's library date, excluded the sleep screenshot from the food gallery, and sent no pixels for the display request. A separate request read **7 h 45 min** from the saved synthetic sleep screenshot. No health or meal records were changed.

Initial photo-gallery checks on 7 September 2026 passed: type checking, lint, 23 progression tests, all 67 domain/database/authentication tests (none skipped), the production build and all 114 browser checks. This included the earlier gentle-coaching changes before publication.

Published with the coaching, design and ingredient changes on 7 September 2026. See the [verified Railway release](coach-design-deployment-2026-09-07.md) for the deployed source and final combined checks.

## Shared enlarged photo viewer

Food records, the image library, saved chat attachments, unsent attachments and Coach galleries now share the same tap-to-open viewer through `FoodPhotoImage`. The full image fits within the phone or desktop viewport without thumbnail cropping. The viewer offers Close, Escape, backdrop dismissal and an authenticated blob download; closing returns focus to the originating thumbnail without moving the page. Thumbnail buttons use `type="button"`, so inspecting an unsent attachment never submits the chat form.

Opening the viewer fetches the image again with the current account header and no cache. Failed access shows an unavailable message instead of reusing thumbnail bytes. The full-size blob is revoked when the viewer unmounts, and account/image keys prevent a previous image from appearing after a change. Viewing is local UI interaction, never a Coach request or journal mutation.

Shared-viewer verification: production build, typecheck and lint passed. Existing food, image-library, gallery and chat regressions passed (27 browser checks), and the final viewer/gallery checks passed across Chromium, WebKit and Firefox (six checks). The new coverage verifies landscape and portrait fitting, keyboard opening/closing, focus restoration, fresh access checks and preservation of unsent drafts without a chat or journal write.
