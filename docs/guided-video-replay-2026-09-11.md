# Guided video replay

Implementation, 11 September 2026. Builds on the [technology research](video-coaching-simplification-research-2026-09-11.md).

The latest review and overlay behavior is documented in the [12 September evidence-review update](video-evidence-review-2026-09-12.md).

## User experience

Choose **Upload lift** in the existing video review screen. File selection starts upload and analysis without a required question, lift selector, trim or calibration. Limits remain 50 MB and two minutes. Optional details allow a reported load/date/lift, a manually selected 0.5–20 second clip, or calibrated bar measurements. Upload must finish before closing the screen; acknowledged jobs continue across navigation and restarts.

The review leads with a guided player and a clear next-step card. **Watch this moment** plays the supporting interval at half speed, then freezes on its evidence frame. A short caption explains what to try. Visible body landmarks can be highlighted on the replay; uncertain or missing landmarks are omitted. Normal/half/quarter speed, scrubbing, an overlay toggle and enlarged playback are available. Enlarging uses the same player inside the page, preserving the overlay on iPhone instead of invoking native video-only fullscreen. Escape reduces the player before closing the review.

Full prose, identification notes, experimental measurements, original-clip download and JSON export are secondary. Video downloads remain unannotated MP4s; this release does not burn annotations into an exported movie.

## Evidence pipeline

Automatic mode preserves the entire bounded upload, including rack pauses and later jerks. FFmpeg normalizes rotation, strips audio/metadata and retains presentation timing. Long clips use 24 full-timeline samples plus motion-focused samples, totalling 48 images in eight sheets. This is an evidence-selection heuristic, not lift recognition.

The existing configured visual Coach model identifies up to three chronological attempts from those sheets. Server checks validate the bounds, actual sampled frame labels and movement phase order. A clean plus later jerk must be one attempt. Overlapping attempts, phases outside an attempt, contradictory lift labels and a suspicious separate clean/jerk pair withhold confident classification. More or ambiguous repetitions receive a request for a shorter clip rather than fabricated reviews.

For each reviewable attempt, a second local decoding pass produces 48 evidence frames with dense neighbourhoods around detected phases (target spacing 1/12 second where source frames exist), plus complete-attempt context. Frames are selected from actual decoded timestamps, never interpolated. The normal visual Coach then returns structured observations, one cue, a next-attempt check, evidence frame references and a focus region. There is one identification call and at most one coaching call per reviewable attempt. Dense evidence preparation adds no paid model call.

Update, 12 September: a partial attempt with validated visible phases now reaches coaching even when the complete lift cannot be named. Previously that condition skipped the coaching call entirely. Partial reviews use neutral position/movement feedback, the same timestamp validation and overlays, and a visible scope note. They do not invent earlier pulls or catches from an opening front-rack hold. The parser rejects lift-specific claims in partial strengths/cues and retains the first-pass visibility limitation. Non-lifting, malformed, conflicting or empty phase evidence still does not receive fabricated coaching. Both automatic and manually trimmed uploads support this behavior. Existing saved reviews can be reanalysed with **Analyse again**, without choosing a lift or uploading again; saved user reviews are not automatically reprocessed.

Validation converts frame references into playback timestamps. It rejects invented/out-of-range references, observations spanning over five seconds, invalid regions, arbitrary coordinate fields and conflicting lift names. Corrections are withheld when visual evidence is insufficient. Existing manual/queued prose reviews remain readable. Correcting and reanalysing a review clears both identification and derived coaching checkpoints.

## Local body highlights

This first implementation uses CPU MediaPipe Pose Landmarker Lite, one of the research proposal's lightweight candidates. The library is pinned to 0.10.32, with pinned NumPy/OpenCV versions. Model weights are downloaded from Google's public model storage during image build, pinned by SHA-256. There are no downloads during a user's review.

Tracking runs at up to 20 sampled frames per playback second, using actual timestamps. It stores selected 2D body landmarks only, with visibility/presence thresholds. Multiple detected people disable subsequent body highlighting; discontinuities and hidden landmarks create explicit gaps. The player does not bridge those gaps or retain stale points. These thresholds are engineering filters, not calibrated probabilities or validated joint measurements.

The production Linux tracking process applies a libseccomp filter that denies socket creation before loading the pose library. This includes native SDK networking/metrics. Decoder subprocesses receive no database, authentication or provider credentials. An unavailable tracking backend preserves timestamped coaching and reports the missing highlight capability.

The language model supplies a region and explanation, never overlay coordinates. The renderer uses local landmarks for circles/highlights and keeps the instruction caption outside the athlete's silhouette. It does not draw a made-up ideal bar trajectory or claim force, power, injury risk, technique scores or precise joint angles. Optional manually calibrated bar tracking retains the prior conservative measurement rules.

## Persistence and operations

Existing account authentication, invitation checks, pinned account headers, private/no-store media and ownership checks remain in place. Pose frames are omitted from list responses and fetched only with the selected private review. Source deletion, lease fencing and account revocation checks remain active. Jobs checkpoint identification and completed per-attempt feedback, so retries reuse saved media and completed model results. Dense temporary frames are deleted after use. Storage reserves 50 MB per in-flight upload and includes the final analysis payload when settling usage.

Runtime additions: Python virtual environment `/opt/video-env`, `VIDEO_PYTHON_PATH=/opt/video-env/bin/python`, `VIDEO_POSE_MODEL_PATH=/opt/video-models/pose.task`, and libseccomp. Existing deployments that override the Python path must use the virtual environment. The Docker image installs and checksums the model at build time. No schema migration is needed; additions use the existing account-scoped analysis JSON.

## Validation and boundaries

Regression checks cover automatic upload and idempotent retry, incomplete/conflicting identification, invalid evidence timestamps, missing landmark intervals, correct account isolation, checkpoint reuse, dense FFmpeg frame extraction, local pose backend initialization, blocked native network sockets and Safari/Chrome/Firefox playback. Tests use synthetic media/accounts and stubbed Coach responses. Mobile screenshots are inspected in addition to layout, keyboard and accessibility assertions.

No paid inference benchmark or analysis of a real athlete was performed during implementation. This is experimental visual feedback, not a validated biomechanics system. The research recommendation to compare expert-labelled lifting clips remains necessary before claiming coaching accuracy.

Gemini native-video routing, SAM/TAPNext++ GPU tracking, automatic calibrated bar measurements and annotated MP4 export are not introduced in this release. The normal Coach provider and its collection/ZDR restrictions remain unchanged. This delivers the simple upload and guided replay experience using the current deployment; advanced model selection remains a separate benchmark rather than an untested provider switch.
