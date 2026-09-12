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

Production verification is recorded below after deployment. Existing ready reviews
are not automatically reprocessed.
