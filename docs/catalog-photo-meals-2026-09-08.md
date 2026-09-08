# Meals from saved photos

Coach could retrieve a saved food photo with `inspect_images`, but meal preparation only allowed current attachments or photos retained from an existing meal/review. This rejected an inspected library photo and led Coach to report that no proposal could be created.

Meal preparation now also accepts image IDs whose pixels reached the model during the current turn. Inspection in the same tool batch does not count: the model must receive the pixels before preparing the meal. Catalog metadata and gallery display alone remain insufficient. Ownership, current Food category, source links, estimated nutrition, review before saving, revision checks, retry protection and undo remain enforced. Sleep and other non-food images cannot become meal sources. Nothing changes in stored meals automatically.

The tool description and fixed capability policy now explain the supported sequence: find the catalog photo, inspect it, read the pixels, and prepare the linked meal for review. They explicitly remove the re-upload requirement. Conversational style and model configuration are unchanged.

The fixed-policy hash was deliberately updated alongside a new deterministic execution baseline in `tests/coach-catalog-meals-database.test.ts`. It exercises the real tool engine and test database with scripted model replies and synthetic images. Coverage includes catalog lookup, inspection, review, pending corrections without re-upload, save/retry, edits with additional saved photos, undo, grouped meal reviews, same-batch recovery, source-link enforcement, metadata/gallery-only rejection, and foreign/deleted/recategorised/non-food rejection. Existing image and nutrition database tests also pass.

These checks verify tool behavior and account boundaries. They do not measure real-model food recognition or conversational quality, and the earlier GEPA results do not establish the quality of this revised fixed policy. No fresh live-provider evaluation or prompt optimization was performed for this fix.

## Follow-up continuity

A subsequent report showed a second break in the conversation: a food photo was followed by a meal-type question, and the short answer had no original image IDs in its model context. Recent messages now carry their original attachment IDs, with an explicit instruction that pixels are absent and must be retrieved for further visual analysis. Historical images are not automatically sent again. A regression covers an attached photo, an unanswered meal review, a reply of “Breakfast”, inspection of that exact source, and successful review with the original photo link.

The capability policy now treats meal occasion as an editable review field: use the stated occasion or meal context, otherwise disclose a snack assumption rather than blocking an explicit request to estimate and prepare food. Material questions about portions or additions remain available. Daily summaries must distinguish saved food from recent requests that failed or still await clarification/review. A status question does not authorize saving those outstanding requests. The fixed-policy hash was deliberately refreshed with this deterministic follow-up baseline; conversational style remains unchanged.
