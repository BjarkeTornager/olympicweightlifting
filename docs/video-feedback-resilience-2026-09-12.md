# Preserve segmentation and recover video feedback

The latest reported failure occurred after frame extraction and SAM segmentation. The private checkpoint contained 57 frames with outlines, but feedback validation exhausted its immediate repair. The old pipeline published geometry only after coaching succeeded, so the user saw a retry screen despite successful GPU processing. The original rejected model text was deliberately not retained, and historic deployment logs did not provide a more specific validation code. Its precise original validation fault is therefore unconfirmed.

## Changes

- Publish validated segmentation and exact-frame pose results before requesting coaching. Older failed reviews can read validated segmentation geometry from their existing private checkpoint. Contact sheets, source media and diagnostic fields remain excluded from the review JSON.
- Give the immediate repair the previous response and exact schema/evidence failure details in memory. Diagnostics include only known field names and fixed error codes, never private response values or unknown property names. Persist the final diagnostic inside the private checkpoint so deployment changes cannot erase it.
- Treat references to unseen lifts in the limitations field separately from contradictory lift-specific recommendations. For example, “the preceding clean is not visible” must not invalidate otherwise supported jerk feedback. Contradictory strengths or coaching cues still fail validation.
- Retry recoverable feedback/provider failures in the existing durable queue, with 30/60-second backoff and a maximum of three job attempts. Retry uses the saved current-version refined frames and GPU checkpoint. Deletion, account revocation and lease replacement cannot restart a job. Invalid evidence never becomes fabricated feedback.
- Explain that outlines are available while feedback is being recovered. Strip dense segmentation frames from list polling; the owner-scoped detail endpoint supplies geometry when a review is opened.

## Validation

- Production checks: typecheck, lint, 23 legacy progression checks and 172 application tests passed.
- Chromium and Safari WebKit: 16 video upload, replay, recovery and access checks passed using synthetic accounts and fixtures.
- Additional database regression verifies recovery of older checkpoint-only outlines, private DTO boundaries, backoff, bounded exhaustion and reuse without another GPU call.
- Final production build, typecheck and changed-file lint passed after the legacy-checkpoint compatibility change.
- Railway deployment `3590b4f8-d970-4251-97d0-ede7e4b619ac` succeeded from exact source commit `2378a6b72b5a5def77873dbb7520f76170cc9f5b`. The source archive excluded credentials, private artifacts and unrelated untracked work.
- All 16 Chromium/WebKit video checks also passed against the hosted release with synthetic intercepted account data. Live readiness returned 200; unauthenticated journal, image and Coach requests returned 401 with private/no-store caching. Hosted video access tests verified unsigned listing, details, playback and mutation rejection.
- Read-only container checks confirmed the new automatic recovery, precise validation diagnostics and checkpoint geometry compatibility code are running. A read-only check of saved regions found athlete outlines and some plate outlines in the affected clip; no new private-media model/GPU request was made.

The real affected clip still needs a successful coaching replay and a visual check of the resulting evidence markers. Automatic approval review blocked the isolated model replay because it would transmit private frames; explicit approval for this clip's existing OpenRouter/Modal processing has been requested. Do not describe that replay as completed until verified.
