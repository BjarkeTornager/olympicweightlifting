# Evidence-based lifting-video review

12 September 2026. Updates the [guided replay implementation](guided-video-replay-2026-09-11.md).

## Problems addressed

The detailed review previously inherited the initial sampled-frame lift label. An early wrong guess could therefore anchor the recommendations even when denser frames showed something else. The player also froze the earliest cited frame, regardless of which best showed the issue, and drew body highlights across the broader replay interval. Detecting a second person permanently disabled pose highlights. Older saved feedback continued to look like a current review.

## Analysis

Both automatic uploads and manual clips now use one shared review pipeline. The first pass locates an attempt and its visible phases. Dense frames are then reviewed independently: the initial lift label and selected label are withheld from that model request. The response supplies fresh phase evidence and coaching together. Server validation determines the movement from the new chronology, respects an explicit user selection, and rejects conflicting advice. An initial snatch guess can thus be corrected by visible front-rack receipt and a later separate overhead drive. No third model call was added: there remains one initial identification call and at most one detailed review per reviewable attempt.

Recommendations distinguish position evidence from movement evidence. Motion claims require at least two distinct timestamps; evidence must span at most 2.5 seconds. The model chooses a focus frame from its cited frames rather than the server always choosing the earliest frame. Instructions require a specific visible issue, one practical cue and an observable next-attempt check. Lift identification alone is not a strength. Partial clips still receive scoped feedback without inventing unseen phases or a lift name.

These constraints validate structure and chronology, not the truth of a model's visual interpretation. They do not establish coaching accuracy. No real-athlete or paid-model benchmark has been run for this release.

## Overlay and playback

**Freeze & inspect** pauses at the selected evidence frame. Supporting-frame buttons allow direct before/after comparison. **Watch this moment** retains slow contextual playback and returns to the evidence frame. The caption separates the observed issue from the next-attempt cue.

Body markers are shown during inspection only, at an evidence timestamp with an exact corresponding pose sample. Markers from nearby frames are not used. Missing or ambiguous tracking produces an explanation, not a guessed marker. The optional bar trail is off by default, uses only the last 1.5 seconds and never connects points across timing gaps. It is not an ideal trajectory or a prescription.

Paused inspection uses the video's settled playback position rather than late presentation-callback timestamps. Callbacks arriving during seeks are ignored and body markers stay hidden until seeking finishes. A regression test simulates an old callback after enlargement, preventing the Safari overlay disappearance seen in the previous full CI run.

Inspection requests made before media metadata is available are retained and applied when the clip is ready. The already-downloaded private blob is preloaded for decoding. A second regression deliberately delays media readiness: no marker appears before the requested frame is decoded, then inspection resumes without requiring another tap.

Cue selection centres the actual video, rather than scrolling the whole review with its taller feedback cards. The Linux WebKit failure trace showed the video entirely outside the viewport after inspection was selected, with the decoder stuck seeking. The browser regression now checks that at least 95% of the video is onscreen before expecting the evidence highlight; the same rule applies to slow replay.

## Foreground tracking

Local MediaPipe inference remains CPU-based with the existing pinned model and Linux socket isolation. The selector can follow a dominant foreground body with background spectators present. It matches visible torso anchors and body scale, suppresses ambiguous matches, permits short tracking gaps, and never falls back to a different remaining person after losing the selected subject. This is a conservative geometric heuristic, not person recognition; it may still fail when a spotter is more prominent, bodies overlap, or the athlete is obscured.

Dense decoding evaluates the actual evidence frames, with up to 10 Hz continuity samples between them. Those exact-frame landmarks replace older markers, including explicit empty points when tracking fails. Existing source processing remains at up to 20 Hz. No images, pose data or credentials are sent by the local tracking subprocess.

MediaPipe's [official Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python) documents timestamped video inference, landmark visibility/presence and the configurable pose-count bound. It does not promise athlete identity tracking; the foreground selection and omission rules are application logic requiring real-video evaluation. The player uses presented-frame media time following the [browser API documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

## Saved reviews and verification

Completed results carry review version 2. Older results show **Update analysis** and keep their previous notes collapsed. They are not automatically reprocessed. Rerunning a saved clip uses private stored media, recomputes evidence-frame poses, and discards earlier pipeline checkpoints. Current-version retries retain completed attempts, account ownership checks, lease fencing and idempotency. No database migration or user health-record edit is involved.

Regression coverage includes independent correction of an early wrong label, strict focus-frame validation, rejecting motion claims based on one still, exact-frame marker selection, removal of stale markers, spectator continuity and ambiguity, reanalysis/owner isolation, gap-safe bar trails, and Safari/Chrome/Firefox inspection and playback. Tests use synthetic media, model responses, landmarks and accounts. Actual lifting footage with expert-labelled phases and technique observations is still needed to measure recommendation accuracy and subject-selection reliability.
