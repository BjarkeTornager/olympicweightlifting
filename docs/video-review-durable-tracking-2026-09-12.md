# Durable tracking and transition coverage

Date: 12 September 2026.

A production segmentation request stayed pending for the whole five-minute
client allowance. The app cancelled it before GPU execution began; the GPU
subsequently rejected its expired queue deadline. The app still called the
remaining partial coaching response “Review ready”. Separately, the refinement
sampler used most of its frame budget around known poses, leaving a gap between
the front rack and overhead receipt.

## Changes

- Persist decoded refinement evidence before optional GPU dispatch. Persist the
  signed receipt privately and resume the same Modal call across worker yields
  and process restarts. Canonical manifest hashing survives PostgreSQL JSONB
  property reordering and binds the receipt to destination, media and evidence.
- Keep the GPU receipt valid for at most 15 minutes. App workers poll for at most
  90 seconds per turn, then requeue after 15 seconds without consuming a failure
  retry. Authentication, account fencing and bounded cancellation remain.
- Keep receipts and sampled images out of list/detail responses and Coach data.
  A submit response lost before checkpointing can still leave bounded orphan
  work; this is not an exactly-once guarantee.
- Fill gaps throughout the detected movement window, retaining exact phase
  timestamps and context across the full attempt. All samples are decoded source
  frames. No synthetic frames or assumed movement labels are introduced.
- Distinguish processing failure from an unconfident subject match. Label partial
  results explicitly, including older saved reviews. Empty correction markers
  no longer imply that every part of the lift was assessed or performed correctly.

## Validation

- 175 repository tests plus 23 legacy tests, type checking and lint passed.
- The database regression exercises five consecutive queue yields, one GPU
  submission, one refinement decode, receipt privacy and successful continuation.
- Protocol tests cover a simulated wait beyond five minutes, process recovery,
  canonical manifest identity, foreign destination/media/evidence rejection,
  expiration and cancellation. No actual GPU or LLM is called by these tests.
- 18 Python gateway/segmentation tests and four sampling regressions passed.
  Synthetic rack-to-overhead sampling retains a maximum 0.25-second gap in that
  fixture; this is not a universal coverage or coaching-accuracy claim.
- 16 Chrome/WebKit browser tests passed for replay, incomplete results and video
  workflows. Actual private uploads have not been regenerated as part of these
  checks; previously saved feedback remains until reanalysis is requested.

The Modal gateway change was deployed with no minimum idle GPU. The website
release uses an exact tracked-source archive. Private media and credentials are
excluded. This change does not broaden the owner-only segmentation pilot.


## Moving overlay follow-up

The player previously hid all region outlines during playback. Tracked replay
now captures an observed video frame and its matching masks together on a canvas,
then advances to the next analysed frame. Explicit occlusions, skipped evidence
and long gaps restore the original unmarked video. The separate inspection
button seeks to a real frame with saved outlines. Coach captions and region
outlines have independent visibility controls.

The implementation uses the browser's presented media timestamp rather than a
wall-clock estimate. See [requestVideoFrameCallback documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
This is sampled visual replay, not continuous anatomical tracking or a velocity
measurement. No interpolation or new inference is performed by the browser.
