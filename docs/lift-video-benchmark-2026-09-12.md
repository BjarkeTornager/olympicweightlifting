# YouTube lift-video benchmark — 12 September 2026

The pilot found a real response-validation bug and a large tracking-coverage
problem. It does **not** yet establish that any model or tracker delivers
expert-level coaching. The next investment should be better visual evidence and
independent annotations, with model advice checked against that evidence.

## Footage actually tested

| Source | Evaluation segments in source time | Purpose |
| --- | --- | --- |
| [Catalyst Athletics: Clean & Jerk](https://www.youtube.com/watch?v=bNCXgyosXlc) | 0:08–0:15.4; 0:16–0:27.2 | Two athletes; one short and one long pause between clean and jerk |
| [Technique Review 1 — Clean](https://www.youtube.com/watch?v=EI3wC9ZyOes) | 0:12–0:15.4 | Pull and front-rack receipt, compared with the coach's discussion of backward displacement and turnover connection |
| [Review 2 — Snatch](https://www.youtube.com/watch?v=HuLNhAsQY7A) | 0:11.6–0:15.25 | Direct pull to overhead, compared with the coach's discussion of backward displacement and bar separation |
| Derived excerpts from the first demonstration | 0:11.1–0:14.9; 0:11.1–0:12 | Jerk without preceding clean; short front-rack excerpt without an overhead receipt |

Six cases, three source videos and four athletes. The full source metadata and
provisional expectations are in [cases.json](../scripts/video/benchmark/cases.json).
The clean-and-jerk source is also documented in Catalyst's
[exercise library](https://www.catalystathletics.com/exercise/76/Clean-Jerk/).
The snatch reference has a [canonical coaching page](https://www.catalystathletics.com/video/1650/Review-2-Snatch/).

The local excerpts exclude audio, subtitles, titles and coach drawings. Review
clips are cropped to remove the narrator; the masks cover narrator overlap over
unused floor. Later scrubbing is excluded. Transcript commentary supplies
reference themes but is never included in the model prompt. Downloaded footage,
transcripts and raw model output remain outside the repository, for private
evaluation; no redistribution or training license is asserted.

## Paid comparison

The same production review prompt, 48 sampled frames in eight contact sheets and
response parser were used. Requests used low reasoning effort, an 8,192-token
output ceiling, no mutation tools, ZDR endpoints and disabled data collection.
This tests the review component directly, not the complete background worker's
attempt discovery and dense-refinement pipeline.

| Model | Completed responses | Usable structured reviews after the parser fix | Median request time | Mean cost per completed review |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | 2 | 2 | 13.90 s | $0.00729 |
| Gemini 3.8 Flash | 6 | 5 | 5.43 s | $0.00879 |
| GPT-6 Astra | 6 | 6 | 18.20 s | $0.32004 |
| Qwen3.6-27B | 0 | — | Timed out at 180 s | Unsettled reservation |

Luna additionally encountered two upstream rate-limit errors; its remaining two
cases were not run. A first Luna request was rejected by routing because Azure
requires `max_completion_tokens`. The harness was corrected before successful
Luna/Astra requests. Gemini's median hides a 67.78-second outlier. These are small,
single-run observations of these endpoints, not stable model performance claims.

No completed response supplied a wrong confident lift name. Several responses
abstained from naming a lift when the excerpt omitted recovery, while retaining
visible phase observations. That is different from misidentifying a clean and
jerk as a snatch. The samples are too few to estimate error rates.

**Actual confirmed evaluation usage: $1.99540.** The conservative total including
all unreconciled failure/timeout reservations is **$2.50292**, below the authorized
$10 cap. Usage comes from individual provider responses; no account-wide spending
is attributed to this experiment. Failed-generation billing lookups did not
resolve two rate-limited requests, so their allowances remain reserved.

The native-video comparison is now complete on three cases. The first request
was rejected because the production API key had less than the required $1 of
unused key allowance, even though the account had credit. After explicit approval
and account verification, an isolated $3 key with one-hour expiry was used for
three successful requests. The key was deleted and its local credential file
removed afterward; the key list was checked to confirm only the production key
remained. No production key limit or billing setting was changed and no credit
purchase was made. The earlier failed request and its reservation were retained.

## Direct video versus sampled frames

Cases 01, 03 and 06 were sent as silent MP4 input to Gemini using OpenRouter's
static video-processing mode. The comparison used the existing review schema
and prompt with an explicit input adaptation, mapping reported moments to the
same 48 timestamp anchors. It did not optimize a separate native-video prompt or
set a verified dense sampling rate. These results apply to this configuration,
not to every possible native-video setup.

| Gemini 3.8 Flash input, same three cases | Completed | Passed structural checks | Median request time | Mean cost |
| --- | ---: | ---: | ---: | ---: |
| Silent video, static mode | 3 | 2 | 5.53 s | $0.00261 |
| Eight contact sheets, 48 frames | 3 | 2 | 5.74 s | $0.00897 |

The three additional requests cost **$0.00783075 total**. The API reported video
input tokens, confirming that these were video requests. It did not expose the
actual sampled frame timestamps, so fewer tokens cannot be treated as equivalent
temporal coverage at a lower price.

Direct video did not establish a coaching improvement:

- Case 01 retained the correct clean-to-jerk sequence, but selected focus anchor
  27 while citing only 26 and 28. The parser correctly rejected the replay marker.
  Visual inspection did not establish the claimed loss of rack contact as a
  justified correction from those cited images.
- Case 03 passed the schema checks but placed the overhead receipt at anchor 15
  (1.083 s). Inspection shows the bar still below overhead during pull/extension
  there; an overhead squat is visible at anchor 22 (1.617 s). Its recommendation
  to stand more decisively also did not establish the reference coach's main
  balance and bar-separation issues. A structurally valid marker can still be
  visually wrong.
- Case 06 correctly retained the clean, long rack pause and subsequent jerk. Its
  cue alleged backward hip movement/forward torso inclination during the dip,
  citing anchors 34–36. Those anchors span a rack hold and rapid drive/transition;
  the inspected images do not establish that this is the athlete's priority
  correction. Dense phase inspection is still needed.

There is no basis here to replace the frame pipeline with default static video.
The useful next experiment is explicit temporal sampling and independent checks
of cited events, alongside measured tracking. Do not relax replay validation to
make the completion rate look better. A validated response format is not a
validated coaching recommendation.

## Coaching findings

- **Astra was more restrained in this small sample.** It declined to manufacture
  corrections for the first demonstration and the short rack excerpt. Its snatch
  cue addressed excessive backward torso movement, which overlaps the reference
  coach's concerns. Its second clean-and-jerk review identified an extra forward
  foot movement during split recovery; visual inspection of the cited three
  frames supported that observation. This is a useful example, not a coach-rated
  accuracy score.
- **Gemini is a promising inexpensive candidate, with quality checks still
  necessary.** On the clean review it emphasized head position rather than the
  reference coach's main balance/turnover priorities. It also suggested speeding
  split recovery on another clip without establishing why the pause was harmful.
  One otherwise valid clean-and-jerk response selected focus frame 4 while citing
  only frames 3 and 5; the application correctly rejected that unsupported replay
  marker. Its short-rack advice was largely generic.
- **Luna's small successful sample cannot establish comparative quality.** It
  offered corrections for the good demonstration that Astra/Gemini did not deem
  justified. Its clean cue described completing the rack, but did not establish
  the reference coach's proposed mechanism. Availability errors further limited
  comparison.
- None of these observations replaces an independent weightlifting coach's
  blinded assessment. Agreement with source commentary should be assessed by
  issue, evidence and cue quality, not keyword matching or a second LLM's score.

## A bug fixed from actual output

Astra described the early pull and a later point in the same pull as two `pull`
observations. The validator treated any repeated phase as contradictory and
discarded its entire otherwise grounded partial review.

The fix preserves consecutive observations within the same phase **only as a
partial review**, with no confident lift label. A phase recurring after another
phase still fails, as do conflicting rack/direct-to-overhead sequences, invalid
timestamps and non-lifting footage. The stored real response now parses without
another model call. Regression tests cover the complete review path, including
retained feedback timestamps.

This change is local and tested; it has not been deployed as part of this research
run. It does not automatically replace previously saved user analyses.

## Overlay findings

The production decoder and MediaPipe runtime were run on all six clips. On the
isolated jerk, only 24 of 76 sampled pose frames retained any body points, versus
144 of 148 in the longer clean-and-jerk excerpt containing that same jerk. This
shows sensitivity to initialization/continuity, not a measurement of final overlay
accuracy. Production refinement can change sampling, so these are initial-pass
availability results.

The current seeded template tracker was compared with OpenCV CSRT on three clips,
using the same manually selected plate and starting region:

| Clip | Current tracker coverage | CSRT coverage |
| --- | ---: | ---: |
| Clean and jerk | 3.4% | 100% |
| Clean review | 38.7% | 100% |
| Snatch review | 9.1% | 100% |

CSRT stayed on the selected plate in the inspected montage frames. **Coverage is
not coordinate accuracy**: there are no independently annotated plate centers
yet, and a tracker can drift while continuing to return coordinates. These clips
also do not test severe occlusion or automatic plate selection. The comparison
does not justify replacing the production tracker without further checks.

Pixel tracks and local comparison replays were generated, but no velocity, force,
power or physical displacement is reported. Oblique views and unverified replay
speed make those claims inappropriate.

## What to build next

1. Annotate plate centers, visible joints, occlusion, subject identity and phase
   boundaries on a broader set, holding out entire source videos and athletes.
   Include failures, poor lighting, ordinary phone footage and multiple people.
2. Compare CSRT with learned point trackers and RTMPose with the current pose
   pipeline. Require low coordinate error and reliable disappearance during
   occlusion, rather than rewarding uninterrupted output alone. The
   [technology research](lift-video-research-2026-09-12.md) covers licensing and
   candidate architectures.
3. Keep overlay geometry in the vision pipeline. Give the coaching model supported
   phase windows and visible tracks; require an observation, a practical cue and
   a checkable expected change. Do not ask an LLM to invent an ideal bar path.
4. Compare explicit dense video sampling and a cheap first pass plus selective
   Astra review against Astra-only coaching on blinded coach annotations. The
   default-static video pilot did not establish an improvement. Do not switch
   the production model solely on this six-case pilot.

Reproduction commands and constraints are in the
[benchmark README](../scripts/video/benchmark/README.md); the per-case scores and
cost ledger summary are in [the results file](lift-video-benchmark-2026-09-12.results.json). The benchmark has a
shared cost ledger, explicit paid-run flag, conservative reservations, endpoint
price ceilings and no automatic retries. The parser fix passed its focused
regression suite, project type checks and lint checks.
