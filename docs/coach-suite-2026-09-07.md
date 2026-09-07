# Coach that follows through

The Coach now turns a report containing several health entries into one review and atomic save. Today offers one optional observation, a next-step action, a workout draft when present, and compact training, food and sleep summaries. Week provides a seven-day review, the preceding seven days for comparison and dated source records. Extra detail is expandable; inactive views do not recalculate while the person types in chat.

## Logging and reuse

`record_bundle` accepts two to six meals, partial check-ins, cardio activities, completed strength sessions or exact meal repeats. Every entry passes the same server validation and required record reads as a single change. Same-date check-in fields must be combined into one entry. Missing values remain absent, and meal estimates and ingredient evidence remain explicit. One confirmation saves all entries in the existing journal transaction. Retry IDs, revision conflicts, expiry and atomic undo apply to the whole review.

Food supports up to 50 favourite meal snapshots. “Review & log” opens the normal meal editor before creating a new entry. Coach can retrieve favourites or repeat an owned meal found in the food journal, including “same breakfast as yesterday”. Copies retain exact portions, nutrition and ingredient tags, but never attach an old photograph as evidence of a new meal.

People can explicitly mark a food day complete. New or changed meal records reopen it. Weekly intake averages use only complete days; sleep averages use only reported nights, including an explicitly reported zero. Coverage for both windows is visible, estimates remain estimates and differences are not interpreted as causes. The Week view opens the records behind each date; “Reflect with Coach” retrieves the computed report before offering a personalised optional adjustment.

## Approved context and follow-up

“What Coach remembers” is available in Coach options and Today. It supports adding, editing and deleting approved preferences, with categories for routines, food, equipment, boundaries and other context. Coach can prepare the same operations in chat; its proposal must be approved before any memory becomes durable. The ordinary conversation remains limited to recent exchanges and is not silently converted into memory.

Agreed plans have a title, details, visible follow-up date, status and optional reported outcome. Only an action the person accepted should become a plan. `dismiss_plan` stops follow-up while retaining a dismissed record; `delete_plan` is reserved for explicitly removing the record. People can also edit, complete, dismiss or remove plans themselves. Opening observations may refer to a due active plan, respect advice-only mode and can be hidden for the day. There are no scheduled notifications, wearable connections or background monitoring.

All these records belong to the signed-in journal and sync with it. They survive exports and imports; conflicting versions are reported rather than silently overwritten. Clearing conversation keeps approved context, while deleting a memory or plan keeps earlier chat messages. The privacy page explains this distinction.

## Compatibility and validation

No database migration or historical-record conversion is needed. Optional fields preserve legacy snapshot shapes. Old cached clients receive compatible journal responses and their writes retain the new fields. Missing additive fields are also retained when an old pending mutation is replayed by the updated browser. Explicit empty arrays clear a collection. Manual undo records track whether their source contained the full Coach schema; ambiguous cached undo is retired when fresh Coach data arrives. Old Coach clients must refresh before submitting or saving a review they cannot render fully; authentication and account checks happen first.

The implementation follows the existing server-owned tool workflow: the model proposes arguments, the server validates them and the person confirms a concrete review. See the [OpenAI function-calling guide](https://developers.openai.com/api/docs/guides/function-calling). The fixed policy was deliberately updated for the new tools and reviewed alongside a fresh synthetic evaluation; the existing conversational style and production Luna routing are retained. This is a feature policy update, not a GEPA-optimised prompt promotion.

Validation covers atomic save/retry/undo, partial health updates, per-entry guards, account separation, ownership of reused records, legacy writes, backup merging, food-day coverage and plan dismissal. The real GPT-5.6 Luna evaluation passed seven synthetic conversations covering eight behaviours: grouped logging, sleep precision, ingredient evidence, exact meal reuse, approved memory, agreed plans, grounded weekly reflection and dismissal. Diagnostic and final runs totalled 52 provider calls and $0.040817095 of reported usage, within a $0.50 cap; no production health records were read or written.

Local production checks passed: type checks, lint, build, 23 progression tests and 81 domain/database/authentication tests. Browser coverage includes mobile layouts at 320–1440 px, accessibility, explicit memory approval/edit/delete, plan dismissal after reload, favourite reuse, grouped save/undo and weekly evidence. Screens were visually reviewed with synthetic records. Exact-commit CI and live deployment evidence are recorded in the release PR.
