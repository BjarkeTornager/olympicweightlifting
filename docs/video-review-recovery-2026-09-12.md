# Video feedback recovery — 12 September 2026

The owner's failed review reached independent lift identification and retained its
normalized video and contact sheets. It then failed final coaching validation with
“Coach could not link this feedback to the lift.” The old pipeline discarded the
invalid model response and recorded no validation reason, so the exact original
invalid field or possible truncation cannot be established retrospectively.

The review used the generic 1,800-token chat output budget for phase evidence plus
up to three guided replay cards. Its strict field lengths were not all stated in
the prompt. Any invalid response immediately failed the job, and refined frames
and optional SAM evidence were not checkpointed before that response was accepted.

## Change

- Video calls get a bounded 4,800-token allowance; chat retains its existing budget
  and the provider retains the same privacy settings and model selection.
- Detect explicit provider length truncation. State the review's exact string,
  frame and array limits in the prompt.
- Retry final feedback once automatically using the same images and a fixed
  validation reason. Do not replay the invalid response or weaken evidence checks.
  Repeated invalid feedback remains a failed review, never a fabricated overlay.
- Save one attempt's refined timestamps, image sheets, pose and SAM result in a
  private nullable `lifting_videos.refinement` column before asking Coach. A retry
  can resume that work without another extraction or GPU call. Clear it atomically
  with completed attempt feedback, on explicit reanalysis, and on account/video
  deletion. Writes retain the user/video/lease fence and existing storage limits.
- Log fixed failure codes only; no private model text, media, email or credentials.

## Validation

- 167 tests passed, including automatic repair of truncated, overlong and invalid
  evidence responses; bounded failure; cancellation; account isolation; reuse of
  private checkpoints after a failed job; and invalidation on explicit reanalysis.
- Type checking, lint, 23 legacy progression checks, and production build passed.
- Migration 0007 adds one nullable JSONB column, compatible with the prior app.

## Production release

- Railway deployment `4f56ba40-b327-4ebc-8b3d-8ecc88eca867` succeeded, from source
  `65815d64d77ea02a4114af636ca4cd8240ecc119`.
- Deployed compiled code contains the recovery path and the checkpoint column is
  present. The owner's verified Google account retains its SAM pilot access.
- Landing, health and readiness return 200. Anonymous journal and video requests
  return 401 with `private, no-store`; foreign-origin video mutations return 403.
- All 12 hosted Chromium/WebKit video tests passed using synthetic fixtures for
  signed-in interactions and real unsigned routes for access checks.
- Deployed an exact tracked-source archive directly through Railway. GitHub push
  remains unavailable due to the previously identified local authentication issue.
  No claim is made that GitHub CI ran for this release. Private artifacts,
  credentials and the unrelated untracked routing draft were excluded.

Only the investigated failed owner review was requeued. Existing ready reviews
were not reprocessed. The live retry finished `ready` with no error, retained its
media, saved validated feedback and cleared its temporary checkpoint. It did not
need the repair pass on this run.

This verifies job recovery, not overlay quality: the optional SAM response
abstained because it could not select the athlete and plates confidently, and
Coach returned no correction moments. The app correctly retained the unmarked
video. This remaining clip-specific quality limitation was reported to the owner;
no reliable outlines or actionable correction markers are claimed for this run.
