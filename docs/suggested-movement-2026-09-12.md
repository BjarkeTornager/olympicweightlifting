# Suggested movement comparison

This replaces the observed-body shadow as the primary comparison. An observed
reconstruction remains available under a separate, collapsed control. It is
never presented as the athlete's correction.

## Athlete experience

The original video remains beneath a translucent **Suggested movement** mesh.
Original/suggested controls, slow comparison playback, the existing scrubber and
shadow visibility make the difference inspectable. The comparison names its
coaching cue and time interval. Outside that interval the original video plays.
The observed reconstruction and the older single-frame 2D guide remain separate.
Old reviews can request **Update analysis** using their existing media.

## Targets and geometry

The initial supported target is maintaining this athlete's suitable earlier
torso orientation in a clear side-view early pull or jerk dip. The visual review
must establish the issue and reference within the same phase. Targets are
computed by code from visible evidence; an LLM cannot specify joint coordinates.

The hip and knee target preserves the earlier trunk orientation while retaining
the shoulders, arms, hand contacts and planted feet. An analytic two-link leg
solve preserves image-plane thigh and shin lengths. This replaces the earlier
shoulder-rotation approach, which could require an unreachable hand position.
Normal extension above the knees, receiving transitions, large camera movement,
unclear joints, unsuitable references and excessive changes are rejected.

On Modal, the pinned [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body)
reconstruction is reposed through its differentiable
[MHR rig](https://github.com/facebookresearch/MHR). Each frame's identity, scale,
camera and hand articulation remain fixed. Joint changes and image-plane root
translation are bounded. The optimizer fits the supported target while retaining
the reconstructed shoulder, arm, hand and foot anchors. A line-search refinement
improves convergence without weakening the final contact/target checks. A prior
on adjacent frames' correction parameters reduces abrupt changes.

The corrected silhouette may extend outside the observed person mask; clipping
it to that mask would conceal exactly the difference the athlete needs to see.
Selected plate pixels are restored where exact masks are available. Alpha keeps
the original video visible. Hidden anatomy, depth and bar contact remain model
estimates; these are not motion-capture measurements or universally ideal poses.

One main supported interval is rendered per attempt, at up to 24 sampled source
frames per second for at most 2.5 seconds. Identity selection stays tied to nearby
SAM masks. A sequence must include its solved focus target, at least two changed
frames and at least 85% renderable samples; otherwise it is withheld. Missing
frames never interpolate invented positions. Playback captures source pixels
and their corresponding shadow together, retaining the existing exact-frame
seek correction. This does not generate an ideal template for every phase of
every lift, or certify that unmodified phases are technically correct.

## Resumability and privacy

Coaching now precedes body rendering. The accepted advice and reference are
checkpointed before the GPU request. A queued retry reuses that same feedback,
media and signed receipt instead of paying for new advice or changing its target.
The request binding includes the complete correction plan. Attempt IDs are
namespaced when results are combined.

The movement protocol explicitly opts in with `motionVersion: 1`; legacy callers
continue receiving the original result shape during deployment. The existing
verified-account pilot, authenticated gateway, temporary media processing,
weights-only persistent volume and owner-scoped review storage remain in place.
Movement textures are excluded from list/Coach-summary responses. Deleting the
review removes its images with the record. Optional body failure or storage
overflow preserves the original video and supported coaching.

## Verification

Engineering tests cover target gating, image-plane limb lengths and contacts,
unreachable geometry, malformed/cross-side plans, stale-result replacement,
private lists, tenant isolation and a queued restart without repeating coaching.
Browser checks exercise original/suggested comparison, missing frames, playback,
scrubbing and visibility on phone/desktop Chromium and WebKit.
Paused evidence waits for the browser's presented frame, not just `seeked` or
`currentTime`. The frame listener survives overlay changes, and playback pauses
before seeking to its final evidence frame. Pixel checks cover Safari's dropped
presentation notification when pause and seek are submitted together.

Public Catalyst Athletics benchmark footage is used with explicitly synthetic
test targets to inspect the GPU geometry and compositor. Such a target is a
software test, not a finding that the demonstration athlete needs that correction.
No private user footage is reanalysed as part of release verification. These
checks do not constitute independent expert validation of coaching accuracy.

The final GPU engineering run rendered all five sampled movement frames,
including the corrected focus position. The isolated target fit reached a
maximum reprojection residual of 0.34 pixels with fixed identity parameters;
that is an internal fit diagnostic, not measured accuracy on a human body.
