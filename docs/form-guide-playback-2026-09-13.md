# Continuous form guide and simplified replay

The review now uses one original video, one timeline and four independent layer
switches: Form guide, Body outline, Bar path and Coach cues. A coaching moment
seeks the same player. The main priority is visible; other observations, practice
instructions, measurements and downloads are collapsed.

## Suggested-form animation

The guide follows the selected athlete's observed timing and proportions. In a
supported side view it constructs bounded image-plane posture adjustments for:

- The initial pull: retain the athlete's starting trunk angle while the hands
  remain below knee level; fade the constraint out as the bar passes the knees.
- The jerk dip: suggest upright support only during a shallow, identified dip
  with the hands still at the front rack. Do not apply this to a clean catch or
  the squat recovery.
- Overhead support: bring the visible shoulder towards the supporting wrist,
  retaining the observed stance, grip, hip and wrist positions.

Two-link inverse kinematics preserves the visible limb lengths and fixed foot /
hand endpoints. Impossible targets are rejected. The selected person's SAM 3.1
silhouette is skinned to the suggested joints; where available, the SAM 3D Body
projection supplies body detail. Existing, genuinely reposed MHR correction
sequences take precedence within their supported interval. These are presented
as an interpolated animation, not new measured evidence.

Teal denotes a suggested change. Grey transition sections follow recorded motion:
they are **not** an assessment that the original movement is ideal. The feature
is an illustrative guide, not a validated optimal whole-lift trajectory, a motion
capture system or a universal set of joint angles. Front/oblique views, hidden
joints and unconfirmed lifts can make the guide unavailable. This limitation is
visible in the player details; an unavailable layer is disabled.

The coaching relationships are based on the primary exercise explanations in
[Catalyst Athletics: Snatch](https://www.catalystathletics.com/exercise/58/Snatch/)
and [Clean & Jerk](https://www.catalystathletics.com/exercise/76/Clean-Jerk/).
They do not establish numerical thresholds or validate our implementation. The
bounds in code are conservative rendering constraints, not diagnostic cut-offs.
No source footage or third-party pose library is shipped in the application.

## Why replay no longer blinks at sampling boundaries

Previously the player captured a still with an overlay at selected timestamps,
held it, then cleared it as the next sample approached. This alternated stills
and moving video. The new transparent canvas is drawn from the original video's
`requestVideoFrameCallback` timestamp on every presented frame. It never replaces
or freezes the original video. The callback chain survives layer changes.

Contours are resampled by arc length, their winding and starting vertices are
aligned, and neighbouring observations are interpolated for display. Joint
interpolation and silhouette skinning use the same playback clock. This display
track does not change any source timestamps, model observations or Coach evidence.
Explicit missing samples, identity changes, cuts and long gaps are not bridged.
Sparse isolated body textures do not flash into view for a single frame.

Paused seeks wait for actual decoder presentation, including on WebKit. Small
positive evidence seeks avoid decoding the preceding frame after rounded PTS.
Texture memory is bounded to the neighbourhood of playback. The canvas and
texture cache are cleared on source replacement and component unmount.

## Privacy and rollout

This changes presentation and adds deterministic guide calculations. It adds no
external provider, model call, GPU job, public endpoint or stored user record.
Existing authenticated media access, account checks, GPU pilot settings, queue
and deletion behaviour remain in use. Older reviews with suitable saved tracking
benefit immediately. A review without suitable tracking needs reanalysis or a
clearer recording; the UI does not present a reconstruction as proof of good form.

## Validation

- Unit regressions cover every intermediate 60 FPS timestamp, backwards seeks,
  contour winding / starting-point changes, occlusion and identity boundaries,
  immutable evidence, changed targets, fixed hands/feet and limb lengths.
- Browser checks exercise repeated playback, source pixels after a paused seek,
  independent layer changes without moving the playhead, mobile layout,
  keyboard enlargement/escape, accessibility, private upload/reanalysis/export
  and deletion.
- Visual checks use the existing public Catalyst clean-and-jerk diagnostic clip.
  It is an engineering check of playback and rendering, not proof of coaching
  accuracy. No private production athlete video or new paid LLM call is needed.
