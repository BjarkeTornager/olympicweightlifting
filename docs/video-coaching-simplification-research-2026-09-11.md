# A simpler lifting video review

Research and proposed implementation, 11 September 2026. This document does not describe a deployed change. No personal videos were sent to new providers and no paid inference benchmarks were run.

The recommendation is **upload → automatic analysis → annotated replay**, using computer vision to locate visible movement and a video model to explain it. Model selection remains provisional until tested on Olympic weightlifting footage.

## The experience

One prominent **Upload lift** action starts processing as soon as the file is selected. Identify the athlete, movement and complete attempt automatically. Remove required trimming and lift selection from the normal flow; leave load and measurements in optional details. Detect the complete clean-and-jerk sequence, including a pause in the rack, before trimming. Do not simply analyse the first 20 seconds. When a video contains multiple attempts, return separate review cards.

The result should lead with the video and one coaching priority:

1. **Watch feedback:** replay the relevant moment slowly, with a short caption and a tracked highlight or arrow.
2. **Try next:** one actionable cue, with an optional drill when justified.
3. **More detail:** strengths, other observations, confidence limitations and optional measurements.

Tapping a feedback card seeks to the supporting moment. Keep captions outside the athlete's silhouette and avoid a permanent full-body skeleton. Provide an unobstructed original-video toggle. Processing continues while the user visits other pages, with a clear completion state in saved reviews.

If the relevant body part is hidden, explain what is visible and omit the unsupported correction. A single fallback control can select the athlete or correct the lift when automatic identification is uncertain. Poor footage should not trigger a long questionnaire.

## What already exists

The current implementation has private uploads, durable background processing, account-scoped storage and playback, retries, lift-phase identification, written coaching and an optional bar-path overlay. FFmpeg produces a selected silent clip and 48 samples in eight contact sheets. Bar tracking currently requires manual plate calibration and uses OpenCV template matching. There is no automatic pose estimation or improvement annotation layer.

Reuse these foundations. The main gaps are automatic attempt selection, better temporal evidence, automatic object tracking and feedback anchored to the replay. Existing implementation details are in [Private lifting video analysis](video-analysis-2026-09-11.md); relevant code is in `components/lifting-video-upload.tsx` and `lib/video/`.

## Technology shortlist

| Responsibility | First candidate | Reason and boundary |
| --- | --- | --- |
| Understand the lift and explain improvements | Gemini 3.8 Flash video input | Supports temporal video understanding. Compare against our current contact-sheet approach on the same clips. |
| Locate athlete and plate | SAM 3.1 segmentation, with a plate/hub detector if needed | Text or visual prompts can initialize object masks. A general segmentation model still needs validation for small plates, crowds and occlusion. |
| Track bar movement | DeepMind TAPNext++ | Tracks selected points over time; needs a correctly detected seed and visibility checks. It does not identify a bar or diagnose technique by itself. |
| Track body landmarks | RTMPose, compared with MediaPipe Pose Landmarker | Test accuracy around the front rack, deep squat and overhead positions. Choose the lighter option if quality is comparable. |
| Render feedback | FFmpeg plus a timestamped SVG/Canvas layer | Reuse the existing video pipeline and render annotations from validated tracks. |

Google's current video documentation supports timestamped analysis, clipping and adjustable sampling. Its default static sampling is only **one frame per second**, which can miss fast action. For short lifting clips, explicitly controlled sampling is a better starting experiment than relying on defaults. Compare approximately 8–12 sampled frames per second around important phases, while tracking motion on original decoded frames. These are proposed benchmark settings, not established optimal rates. [Gemini video documentation](https://ai.google.dev/gemini-api/docs/video-understanding)

TAPNext++ is a promising tracking candidate because the project targets point tracking through difficult motion and occlusion. Its repository explicitly licenses the linked model weights under Apache 2.0. Predicted positions behind an obstruction must not be presented as observed measurements. [DeepMind TAP repository](https://github.com/google-deepmind/tapnet), [TAPNext++ research](https://tap-next-plus-plus.github.io/)

SAM 3.1 supports promptable video segmentation and multi-object tracking. Its CUDA/PyTorch requirements mean a separate GPU worker is the practical integration path for our existing CPU container. It uses a custom SAM license; check the exact release and dependencies before deployment. [SAM repository](https://github.com/facebookresearch/sam3), [SAM 3.1 release](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)

RTMPose offers deployable 2D pose models; MMPose code is Apache 2.0, with chosen checkpoint and dataset terms requiring separate inspection. MediaPipe provides a useful lightweight baseline with 33 landmarks. Neither generic model establishes the accuracy of joint measurements in Olympic lifting. [RTMPose](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose), [MMPose license](https://github.com/open-mmlab/mmpose/blob/main/LICENSE), [MediaPipe Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)

This is a shortlist to test, not a requirement to deploy every model. Prefer a detector and tracker combination that meets quality targets with the smallest operational footprint.

## Make the overlays trustworthy

Store structured observations before generating prose. Each observation should reference a validated time range, movement phase, visible track IDs and evidence frames. The language model can select and explain an observation; it should not invent precise pixel coordinates, angles or physical measurements.

The renderer should distinguish:

- **Observed movement:** solid line, tracked point or highlighted body region.
- **Suggested adjustment:** dashed arrow and a short “Try…” label.

For example, if the evidence supports excessive separation between bar and body during a specific phase, highlight that gap at the relevant moment and give one cue. Do not draw a supposedly universal perfect bar path or generate a ghost athlete presented as the correct movement. A path alone does not establish the cause of a technical issue.

Automatically detecting a plate boundary is not enough: rotating logos, overlapping plates and occlusion can shift apparent centres. Combine hub/ellipse evidence, multiple tracked features and continuity checks. Suppress measurements when the object is lost; reacquisition must not conceal the gap.

Use video presentation timestamps and account for rotation, letterboxing and resizing when positioning graphics. Replace the current `onTimeUpdate`-driven animation with frame callbacks where available. `requestVideoFrameCallback` provides the displayed frame's media time. Test seeking, slow playback and iPhone fullscreen explicitly. A derived MP4 with burned-in annotations provides an export whose overlays remain visible in external players; keep the unannotated clip available. [Video frame callback documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)

No sensor or manual calibration is needed for this qualitative experience. Metric velocity still requires reliable scale, timing and tracking. A published markerless bar-tracking study supports feasibility under controlled conditions, but used eight male weightlifters performing snatches and identified limitations; it does not validate our proposed system across arbitrary camera positions or clean and jerks. [Barbell tracking validation study](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0263224)

## Backend and model routing

Keep the existing private Railway upload, job ownership, retry and deletion architecture. Add checkpoints for attempt detection, tracking, grounded observations and final feedback. Heavy inference can run in a separate GPU service; the website only needs to poll the same review status. Delete temporary frames and provider copies according to the selected retention policy, and preserve deletion/fencing guarantees across worker boundaries.

Use a dedicated video model route, leaving ordinary Coach chat routing unchanged. OpenRouter supports `video_url` content and base64 video, but URL support differs by provider. Its current guide documents static/agentic processing; it does not establish that all custom frame-sampling controls pass through. Verify this before selecting an endpoint. If necessary, use explicit frames or a direct video-provider adapter. Never make a user's clip public to accommodate an API. [OpenRouter video input](https://openrouter.ai/docs/guides/overview/multimodal/videos)

Preserve the current no-collection/ZDR provider restrictions. An EU provider preference is not a strict residency guarantee. If adding direct Google infrastructure, verify model availability, region and retention configuration: a no-training commitment alone does not establish zero retention. [Google retention controls](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)

Measure total cost per useful review, including GPU work, retries and provider tokens. No trustworthy per-review price or latency can be promised before this benchmark. A larger model should handle difficult interpretation only when evidence is sufficient; missing visual evidence needs a better view, not more confident prose.

## Alternatives worth keeping in view

TwelveLabs Pegasus 1.5 is a native-video interpretation challenger for the benchmark, rather than a replacement for coordinate tracking. [Pegasus documentation](https://docs.twelvelabs.io/docs/concepts/models/pegasus)

OpenCap Monocular is particularly interesting for future biomechanics. Its 2026 paper evaluates walking, squatting and sit-to-stand using reference measurements. That is not validation for explosive loaded snatches and jerks. It should remain a separate research track. [OpenCap Monocular paper](https://arxiv.org/abs/2603.24733)

CoTracker is technically relevant, but the repository's majority non-commercial license makes it an unsuitable default dependency for this product without resolving licensing. [CoTracker repository](https://github.com/facebookresearch/co-tracker)

## Implementation order and acceptance

First simplify upload and playback, retain the existing phase-identification safeguards, and make every feedback item seekable. Next benchmark automatic tracking and add only overlays supported by reliable evidence. Introduce measurements later, behind optional details and separate validation.

Use approximately 50–100 consented, coach-labelled clips for an initial pilot, separated by athlete between tuning and evaluation. Include both competition lifts, partial attempts, side and oblique views, different frame rates, slow-motion exports, varied clothing and crowded backgrounds. This is a starting dataset, not sufficient evidence of universal accuracy.

Evaluate wrong-but-confident lift labels, event timestamp error, bar/landmark tracking error, appropriate abstention, expert agreement on the main improvement, cost and tail latency. Compare against the existing system. Specifically require front-rack-plus-jerk evidence never to be confidently reported as a snatch. Verify mobile typing/navigation remains unaffected, overlays survive seeking and fullscreen/export, and cross-account media access stays blocked.

The intended result is a simple coaching replay. The complexity belongs in evidence validation and background processing, not in the upload form.
