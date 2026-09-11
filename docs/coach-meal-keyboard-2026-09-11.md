# Coach: visible phone drafts and save-first meal estimates

The reported phone layout could leave the draft outside the usable area when the keyboard opened. The previous detector compared `innerHeight` with `visualViewport.height - offsetTop`; that misses browsers which shrink both heights or pan the viewport. It also left the sync detail/Undo row visible in the compact layout.

The app now tracks a keyboard-closed height, checks focus and viewport changes, and performs bounded delayed measurements after focus for browsers that miss the initial resize event. It resets its baseline after a substantial width change and avoids treating pinch zoom as the keyboard. An already short phone viewport gets a focused-composer fallback. The compact layout persists through the Send pointer interaction, hides the title, navigation, sync details and footnote, and prioritises the draft and Send. The textarea grows with the draft up to a viewport-based limit, then scrolls internally; text is dark and 17 px on phones. Keyboard dismissal restores navigation without clearing the draft.

Browser context: [Chrome's viewport resize explanation](https://developer.chrome.com/blog/viewport-resize-behavior/) and [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport). These explain possible viewport behaviours; the screenshots alone do not establish a particular browser defect.

## Food logging

The old instructions still asked Coach to clarify quantities and additions before saving, despite the direct logging capability. The meal policy, food shortcut, image logging prompt and tool guidance now agree:

- A recognizable food consumption report is saved immediately with explicit portion/nutrition estimates. Confirmation of the whole tray, meat species, oil or meal category is not a prerequisite.
- A plate presented as the person's meal initially uses the visible serving as an estimate unless they report sharing or leftovers. Packaging uses a reasonable serving, not an assumed whole package. These assumptions remain visible in the saved meal notes and portions.
- Unknown meat stays generically named; an unknown ingredient does not acquire an invented `visible` or `reported` tag. Independently known foods are saved even if another item cannot be identified, with incomplete totals explained.
- “Also eat 3 fried eggs” continues the meal report. Coach reads existing meals, adds to the relevant saved meal or creates it if still unsaved, and preserves other items and source photos when correcting it.
- Corrections update that meal. Existing atomic receipts, retry protection and Undo apply. Success is only claimed after the database confirms the save.

A bounded execution recovery detects explicit English consumption reports answered with a portion-confirmation gate and gives the model one additional instruction to finish the authorized save. It does not fabricate food records, bypass validation, or increase the existing five-round/90-second tool budget. A provider failure or a model that still fails to use the tools can still leave a request unsaved; there is no false success receipt.

Advice, future plans, previews, other people's food and image-library uploads alone still do not authorize intake records. A status question does not backfill previously missed meals. Old reviewed clients retain their confirmation flow. Sleep and activity measurements are not estimated under the food policy. No data migration or real-user record repair is part of this change.

## Validation

Deterministic tests cover the reported clarification failure through the real engine and a local test database, estimated ingredient evidence, one saved meal, correction, idempotent retry, Undo, bounded recovery and older-client compatibility. Browser tests cover simultaneous layout/visual viewport shrinkage, delayed focus measurement, long drafts and caret preservation, a stable Send interaction, keyboard dismissal, and a saved meal receipt with estimates and Undo without a second message. Existing queue, navigation, accessibility and private ownership regressions remain applicable.

The fixed-policy hash is deliberately refreshed for this revision. Tests use synthetic accounts, images and model responses. They validate execution and layout, not live-model accuracy or physical iPhone keyboard behaviour. Historical GEPA scores do not evaluate this policy; no paid model or GEPA run was performed.
