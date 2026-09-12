# Activity photo logging

Train, ongoing workouts and Cardio now offer **Take photo** and **Upload photo**.
Selecting an image saves it in the existing private catalogue, automatically tags
its visible subject, and hands a separate logging message to Coach's queue. The
user's unsent chat draft and ongoing lifting workout are retained. Coach can
finish while the person visits another screen.

Coach's normal image attachment flow recognises Activity images and supplies a
logging request when sent without text. Add images also offers **Log walk, run
or ride**. The existing image library's activity logging action uses the same
instructions. Uploads in the general image library still only catalogue images.

## Recording and source evidence

- Read duration, sport, date and supplied optional measurements from actual
  pixels. Missing measurements stay null; never estimate duration from steps or
  treat planned workouts, daily totals, food intake or sleep reports as cardio.
- Prefer the visible date. The photo-upload request explicitly permits today's
  date only when none is shown, with the assumption noted. Unreadable required
  facts need clarification; optional metrics do not block saving.
- Activity entries carry optional `photoIds`; attached or previously inspected
  source pixels are required. Merely listing metadata, displaying a gallery, or
  inspecting in the same tool batch cannot authorize a source reference.
- Read the date's activities first. Reusing a linked source cannot create a
  second activity. Corrections preserve unspecified values and links. Standard
  direct logging receipts, transaction boundaries, retries and Undo apply.
- Activity history and Coach detail cards show private enlarged-photo previews.
  Edit activity can remove a link; the catalogue keeps the image until explicitly
  deleted. Linked images cannot be deleted or recategorised as Food/Sleep/Other.
- Every journal write rechecks image ownership and category under the journal
  lock. No public photo URLs or new storage service are introduced.

`X-Activity-Photos-Version: 1` keeps old cached strict schemas compatible: legacy
responses omit the new field and their saves preserve existing links. Modern
saves and Undo can explicitly remove them. No SQL migration is required.

Automatic submission requires a one-use, account-scoped upload handoff in memory.
A copied/deep-linked URL only attaches the photo as a draft; it cannot initiate a
save on its own. Actual queued upload jobs use the image UUID as the stable run
ID for retry protection. Reloading before submission leaves the saved image
available to send manually.

## Validation

Production checks passed: type checking, lint, 23 progression checks and 169 app
tests, including the disposable-database privacy/source-link/Undo regressions.
The final handoff and compatibility unit tests also passed. Eighteen Chromium
and WebKit upload, cardio and direct-logging browser checks passed; the four
photo-flow cases additionally check copied-link behavior on the final build.
Browser fixtures intercept all account APIs and model replies. No production
records or paid model evaluations are used; these are functional tests, not a
new OCR/vision accuracy benchmark or a physical-iPhone test. Historical GEPA
scores do not evaluate the revised activity-photo prompt.

The release uses an exact tracked-source archive through Railway CLI. Untracked
drafts, credentials, build caches and private artifacts are excluded. No new
GitHub-hosted CI result is claimed for the direct release.

## Live release

Source `c4d5c9e71905fe0396c7768a92e606edfb3bc6f2` was deployed successfully to
the existing Lift Journal Railway service as
`4257e88e-265d-44ff-b530-d3c4a4da9de1` on 12 September 2026.
`/api/ready` returned 200. Anonymous journal, image collection, individual image
and Coach requests returned 401 with `private, no-store`. The running server
contains the activity evidence guard, account/category validation and cached
client response adapter (the last is in the compiled API route files).

All four activity-photo browser cases passed against the hosted bundle in
Chromium and WebKit, including uploading from a workout, sending via Coach,
finishing during navigation, enlarging the saved photo, retaining the lifting
draft, and opening a copied URL without another automatic save. These checks
used synthetic API responses and did not change real users' journals.
