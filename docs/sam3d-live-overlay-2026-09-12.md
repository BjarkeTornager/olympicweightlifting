# SAM 3D Body overlay release

The verified-account video pilot now supports an **observed 3D body shadow** alongside SAM 3.1 outlines and the existing evidence-based posture guides. The shadow is a projection of the reconstructed athlete onto the exact analysed video frame. It is not an independently validated corrected-form animation.

## What the athlete sees

- New pilot reviews run body reconstruction automatically after the lifter has been selected by SAM 3.1.
- **3D body shadow**, **Inspect 3D body**, **Previous body frame** and **Next body frame** controls sit with the video controls. The original video remains available.
- Playback captures the original frame and matching body projection together. It can briefly retain that complete annotated frame between nearby samples, never a stale mesh on a newer video frame. Missing samples, seeks and gaps clear the shadow. There is no interpolation of hidden poses or invented smooth trajectory.
- **Show suggested correction** can combine the observed body shadow with the existing limited 2D posture guide. The observed shadow turns grey; the suggested joint positions stay teal. Original/reference comparisons remain available. The correction layer is explicitly labelled as a 2D suggestion.
- Older pilot reviews offer **Update analysis**. Existing videos are reused; old reviews are not silently reprocessed. Adding the body layer to a current review preserves the selected lift; legacy reviews still refresh their old identification.

## Backend and privacy

A separate Modal app, `lift-journal-sam3d`, exposes an authenticated CPU `/body` gateway. Unauthorized requests are rejected before payload decoding or GPU dispatch. The existing service token remains server-side; no credential is sent to the browser. The model uses one scale-to-zero L40S worker with bounded startup, execution and queue deadlines.

The gateway receives only the normalized silent MP4, its hash/dimensions/timestamps, and the selected lifter/plate polygons. It validates a bounded binary envelope, hashes the media, and binds its signed queue receipt to the request and service path. The Railway worker additionally binds checkpoints to the endpoint and complete manifest. A worker restart resumes the same GPU input instead of creating duplicate work. The queue receipt is never returned in a review DTO.

Body PNGs live in the owner-scoped review JSON and are removed when the review is deleted. They are stripped from review lists/Coach summary reads and loaded only when a specific review is opened. No database migration is required. Temporary video frames stay in the GPU call's temporary directory; the persistent Modal volume stores model weights only. Account revocation/deletion and lease supersession still fence every save. Optional body failure or storage overflow preserves the usable video and coaching.

Rollout uses `VIDEO_BODY_URL` plus the existing `VIDEO_SAM3_PILOT_EMAIL` and `VIDEO_SAM3_TOKEN`. The pilot is matched against the verified account read by the worker, never upload fields. No Apple Health connection is introduced.

## Model and alignment limits

The source/checkpoint/DINO revisions and model licensing are documented in [the initial feasibility report](lift-correction-preview-2026-09-12.md). The production image reuses those tested pins. The upstream [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) and [MHR](https://github.com/facebookresearch/MHR) source/license files stay in the image/checkpoint distribution.

Body inference uses SAM 3.1's selected-person mask and bounding box. Mesh projection uses the model's camera estimate. A coarse silhouette agreement check rejects obvious mismatches; it is not an accuracy score. Returned textures are clipped to the observed lifter region and exclude selected plate pixels. Hand details, hidden limbs, body shape, depth and exact bar contact remain estimates. The narrow posture guide continues to require its separate visible-joint, phase, reference, limb-length and contact checks. Body reconstruction is not treated as proof of a technical fault.

## Verification

- The production GPU pipeline reconstructed 12 of 12 frames from the existing public Catalyst Athletics clean & jerk benchmark. The complete alpha-texture result was about 542 KB; temporary preview images were visually inspected.
- A real request through the deployed HTTP submit/poll endpoint returned 12 body frames in 33.5 seconds including cold startup/transfer. Unauthorized GET, POST and DELETE returned 401 with `no-store`.
- Production checks passed: TypeScript, ESLint, legacy checks and 184 tests with no skips. A new database case exercised a queued body-job restart, private receipt redaction, owner-only detail access, list-size reduction and deletion.
- Python checks cover authentication before dispatch, invalid source/timestamps/regions, service-bound receipts and projection checks. Existing SAM queue/tracking checks remain in place.
- Browser tests cover phone/desktop Chromium and WebKit, original/shadow/guide comparisons, frame navigation, clearing on missing samples/seeks and existing segmentation replay.
- A real-video pixel comparison found that six-decimal timestamps could seek to the previous frame. Evidence seeks now enter the intended frame by 1 ms (inside the supported source frame interval). Rechecking source frame 161 at 2.683333 seconds confirmed that Chromium and WebKit both present frame 161 under its body texture. A regression covers this rounding boundary and clipping at the video end.

These checks verify integration and rendering behaviour. They do not constitute expert validation of coaching accuracy or a measurement-grade motion-capture benchmark.
