# Overlay availability repair

Automatic uploads previously left bar tracking `not_requested`. The replay also coupled observed SAM 3D Body images to a supported corrected-form interval, and treated an empty correction list as an absence of coaching overlays. These are separate capabilities.

The worker now revisits actual video frames after segmentation and before coaching. It crops the selected SAM person to reduce interference from mirrors and spectators, remaps high-confidence landmarks to the source frame, and retains explicit tracking gaps. Exact evidence frames override older landmarks. This recovery is checkpointed so a waiting GPU job or coaching retry does not repeat it. Manual calibrated tracking retains its path and physical estimates.

Automatic bar tracking seeds a complete coloured plate ellipse near the observed grip line. Appearance, scale and motion continuity constrain subsequent observations. Forward/backward optical flow and a robust affine fit bridge brief failures to fit an ellipse; they do not extrapolate through a missing plate. Ambiguity and longer gaps end the track. Paths are image-plane observations without centimetres or velocity. Separate attempts cannot be joined into one trail. This remains a conservative tracker, not complete coverage of arbitrary clips.

The single player offers recorded 3D body independently of the form guide. Grey reconstructed/interpolated recorded geometry is distinct from a corrected target. Timed phase observations remain available when Coach identifies no justified correction, and actual coaching priorities have a visible text marker even when joint highlights are unavailable. No technique fault or ideal position is manufactured to fill a toggle. Older saved reviews offer an update using the stored clip.

## Verification

- Synthetic tracker checks cover moving plates, off-axis background plates, missing hand observations, occlusion, decoder gaps, identity retention and source-coordinate remapping.
- Pipeline regression covers automatic tracking without calibration, retaining recovered frames between evidence samples, private checkpoints, retries, and owner isolation.
- The focused Chromium check passed for one video, independent overlay availability, recorded-body rendering without a correction and repeated seeks. Twelve related Chromium workflow checks also passed. The decoded-frame stress checks and WebKit runs have not passed reliably in this environment; Safari validation remains outstanding.
- Local public-clip check used the existing Catalyst Athletics clean-and-jerk benchmark (`bNCXgyosXlc`, source interval 8.0–15.4 s), SHA-256 `146ec2dbfe567a2a3d99ca2191abfca7607c98190e55eecf3fcef8b86a6e8e81`. Foreground recovery retained at least ten landmarks in 226 of 234 sampled frames (141 without crop recovery). Automatic tracking retained 68 plate-centre observations from 0.417 to 2.55 s. A contact sheet was visually inspected; the marker followed the foreground plate through the pull and clean receipt. The later jerk path remained unavailable. This is an engineering check, not a coaching-accuracy benchmark or evidence of full-video coverage.

No private athlete video was downloaded for these development checks. Source overlays remain account scoped. Recorded reconstruction and partial bar paths must not be described as validated ideal form or physical measurements.

## Provider budget recovery

Live reprocessing exposed a separate failure: OpenRouter returns HTTP 403 when the app key's monthly allowance is exhausted. The provider adapter previously treated this as a transient server error. A bounded, private error-envelope check now distinguishes exhausted budgets and permission failures; neither consumes three automatic retries. The displayed message explains the action required without including provider response metadata. Reanalysis retains recorded body images for the same clip while discarding correction targets associated with the previous lift label. Database regressions verify both retention and a terminal budget error after one provider attempt.
