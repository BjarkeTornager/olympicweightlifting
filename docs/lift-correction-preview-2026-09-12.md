# Evidence-based coaching and posture preview

This release adds a first, deliberately limited correction preview. It does not provide a validated “perfect-form” reconstruction, a full 3D avatar, or a claim that every lift contains an identifiable fault.

## Website behaviour

- Coach assesses the visible pull, receipt, dip/drive, overhead position and recovery before choosing one main priority and at most two supporting observations.
- Each new priority requests the visible evidence, why it matters, one cue, a brief practice task and a visible result to check next time. Optional demonstrations come from a fixed compatible exercise catalogue; the model cannot invent a video URL.
- The vision review now receives exact-frame visible body landmarks and available bar samples alongside the contact sheets. Missing landmarks stay missing.
- For a clear loss of torso position in the early pull or jerk dip, Coach can request a side-view guide using an earlier suitable position in the same movement. Code computes the suggestion; the model never supplies target coordinates.
- “Show suggested correction” freezes the evidence frame. Original position, suggested correction and earlier reference are individually inspectable. White dashes mark observed geometry; teal marks the illustrative suggestion. The guide disappears during playback, seeking, or away from the actual focus time.
- Reviews can carry forward a clear priority from the same account's latest comparable completed lift within 30 days. This is a reminder, not a before/after assessment: no claim of improvement is supported by the previous text alone.
- Older saved reviews offer **Update analysis**. They are not silently rewritten or reprocessed.

## Geometry and limits

The 2D guide retains the athlete's earlier torso orientation while holding the current hip, leg, foot and hand positions fixed. An analytic two-link arm solve retains the observed upper-arm and forearm lengths and the hand's image-plane bar contact. All calculations use source pixel dimensions, including portrait aspect ratios and mirrored views.

Reject the guide when evidence frames are absent, stale, duplicated, outside the same phase or more than 2.5 seconds apart; when the view, shoulder span or foot movement suggests an unsuitable camera/subject match; when relevant landmarks are missing; or when the target cannot preserve limb lengths/contact without an excessive elbow displacement. Early-pull previews require hands below knee height. Dip previews require hands close to the front shoulders. These checks reduce obvious invalid examples; they are not a validated biomechanical error detector or a reliable camera-calibration method.

The 6–18 degree internal displacement bounds limit the size of the illustration. They are engineering rejection bounds, not clinical/technique thresholds, and are never displayed as measured joint angles. The earlier posture itself must be visually judged suitable. A plausible drawing does not establish that the coaching recommendation is correct. Oblique views and most correction categories intentionally receive evidence highlights and instructions rather than a body guide.

A malformed optional correction request is dropped without throwing away supported coaching. No guide is constructed for tentative recommendations. Absence of a guide does not mean the lift is correct.

## Sources behind the coaching rubric

- [Catalyst Athletics: Snatch Deadlift](https://www.catalystathletics.com/exercise/187/Snatch-Deadlift/) informs the distinction between retaining the starting posture below the knees and normal torso opening later in the pull.
- [Catalyst Athletics: Tall Clean](https://www.catalystathletics.com/exercise/150/Tall-Clean/) provides an optional light-load turnover demonstration.
- [Catalyst Athletics: Jerk Dip](https://www.youtube.com/watch?v=NYIgTh-XyYQ) demonstrates the dip used in the compatible drill catalogue.

The app's short practice instructions are original summaries. These sources inform the rubric; they do not validate automated diagnosis or the generated guide.

## SAM 3D Body prototype status

`facebook/sam-3d-body-dinov3` is a separate gated model from SAM 3.1. On 12 September, a CPU-only check using Modal's existing `lift-journal-sam31-hf` secret returned HTTP 403 for the checkpoint, with the account not on the authorized-access list. After the user submitted the model terms, the status specifically confirmed **awaiting repository-author review**. Granting repository permissions to a token is separate from model access approval. No token value was read locally or exposed.

`scripts/video/sam3d/modal_probe.py` prepares an isolated feasibility probe:

- Pinned [official SAM 3D Body source](https://github.com/facebookresearch/sam-3d-body) at `b5c765a0d89d789985e186d396315e7590887b94`.
- Read-only access preflight and exact checkpoint revision before inference; one scale-to-zero L40S maximum, no public HTTP endpoint, no production API token.
- Explicit image bytes plus an existing selected-person mask; no arbitrary remote media URL or automatic access to users' journals.
- Persistent volume holds model weights only. Selected images and observed body predictions remain in call memory; the requested local output receives the result.
- Returns observed mesh, pose and camera estimate for inspection. It does **not** generate a corrected mesh or claim calibrated depth.

Only Python syntax has been checked for this probe. The container build, checkpoint loading, inference and mesh projection have not yet been verified because account access remains denied. It is not connected to production uploads or deployed as a service. Run a bounded public-clip probe and inspect reprojection, contact and occlusion before any private pilot. The model uses the custom SAM License; MHR terms must also be retained when integrating its rig/assets.

The [official estimator](https://github.com/facebookresearch/sam-3d-body/blob/main/sam_3d_body/sam_3d_body_estimator.py) accepts existing masks and bounding boxes, allowing SAM 3.1's selected lifter to be passed in without choosing a different spectator. Its single-image reconstruction is not a temporally coherent correction model. A future full ghost needs stable identity/body shape, camera agreement, constrained rig optimisation and separately validated coaching targets. [MHR](https://github.com/facebookresearch/MHR) separates body identity from pose and is the intended rig to evaluate for that work.

## Verification

- Production checks passed: TypeScript, ESLint, legacy checks and 180 tests, including the synthetic database tenant-isolation scenario. The final additional malformed-guide regression passed in the focused suite.
- 22 Chromium/WebKit browser checks passed: phone and desktop guide toggles, exact evidence seeking, replay/pause, suppression during playback, private video access, retries and existing segmented replay.
- Reviewed the phone WebKit screenshot using synthetic video/geometry. This verifies interface layout and timing, not real-lift recommendation quality.
- Two further public-clip Luna requests cost US$0.016858947. The shared benchmark ledger now totals US$2.519783782 committed against the existing US$10 cap. Both initially failed because the provider echoed an optional references catalogue; the parser now drops that metadata, retains the validated coaching, and never renders model-supplied source URLs. Replaying those exact responses through the corrected parser correctly identifies clean & jerk and snatch, each with one tentative priority and no unsupported body guide.
- This is a structural/model-output check, not independent confirmation of the technique advice. No private clip reanalysis, 3D inference or expert technique validation is claimed. The final compiled Railway app was also checked for the new controls, with six live Chromium/WebKit checks and anonymous private APIs returning 401/no-store.
