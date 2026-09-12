# Public lift-video diagnostic pilot

This benchmark tests visual phase identification, supported coaching output and
overlay availability on six excerpts from three Catalyst Athletics YouTube videos.
`cases.json` contains source links, cuts, reference themes and provisional labels.
Titles, captions, narrator audio and reference answers are excluded from model input.
Clips from the same source are one group: do not split them across train and test.

This is a **diagnostic pilot**, not a validated estimate of coaching accuracy.
The videos may be in model training data. There is one publisher, four athletes,
selected camera views, and no independent coach annotation yet. An accepted JSON
response is not proof that an observation or recommendation is correct. Source
commentary is a reference, not unquestionable ground truth. Edited replay speed
is unverified, so no velocity, force, power or physical displacement is evaluated.

## Prepare

Use a temporary directory outside the repository, for example
`/private/tmp/lift-youtube-benchmark`. Obtain the public source videos for permitted
private evaluation and place them in `sources/<YouTube ID>.mp4`. The harness does
not download, publish or license third-party media. Do not put media, transcripts
or raw provider output in the repository.

Set `FFMPEG_PATH`, `FFPROBE_PATH`, `VIDEO_PYTHON_PATH` and
`VIDEO_POSE_MODEL_PATH` to the installed video toolchain. Then:

```sh
python scripts/video/benchmark/prepare.py /private/tmp/lift-youtube-benchmark
```

Preparation strips audio and metadata, applies the reviewed crops, preserves
timestamps and uses the existing production decoder. It writes 48 sampled frames
in eight sheets, pose observations, a silent MP4 and a media checksum per case.
Inspect the selected segments before evaluating: later narration may include
rewinding, pauses, or drawings that leak the answer or invalidate motion analysis.

## Paid model comparison

Supply `OPENROUTER_API_KEY` via the environment. Nothing reads a saved personal key
file or connects to the application database. Explicit payment authorization is
required before running this command:

```sh
node --import tsx scripts/video/benchmark/run.ts \
  --paid --budget-usd=10 --root=/private/tmp/lift-youtube-benchmark \
  --models=openai/gpt-5.6-luna,google/gemini-3.8-flash,openai/gpt-6-astra
```

Optional `--cases=clip-01,clip-03` limits the run. Add `--input=native` and select
only compatible Gemini/Qwen models to test silent video input. Native mode uses
the provider's static sampling configuration; the API does not guarantee that
every source frame is seen. It maps reported evidence to the same 48 temporal
anchors for schema comparison; native timestamps are therefore quantized.

The model test calls the existing `reviewMessages` and `parseVideoReview` component
directly. It does **not** claim to execute the complete asynchronous production
worker, including its attempt-finding and dense-refinement passes. This isolates
the model/input comparison from account state and background job behavior.

All runs share `cost-ledger.json` and an exclusive lock. Each call reserves a
conservative input/output allowance before sending, sets endpoint price ceilings,
and settles with provider-reported cost. Unknown charges retain their reservation;
there are no automatic retries. A US$0.50 margin remains below the authorized cap.
Keep the ledger when resuming. A crash can leave a lock: check that no runner is
active before removing that lock, and retain all reservations.

The request uses ZDR endpoints and disallows provider data collection. This is
also deliberately restricted to the fixed six public cases. No production user
images, chats or health records are loaded or changed.

## Local tracking comparison

```sh
python scripts/video/benchmark/tracking.py /private/tmp/lift-youtube-benchmark
```

This compares the production template tracker with OpenCV CSRT using the same
manually selected plate center and initial box. It saves a replay (yellow current
tracker; green CSRT) and normalized point arrays under `tracking/`. A tracker can
return a point on every frame while drifting to the wrong object: coverage and
visual spot checks must not be presented as landmark accuracy. Do not promote a
tracker on coverage alone.

Before production adoption, independently annotate plate centers, visible joints,
identity changes, occlusion intervals and phase boundaries. Measure normalized
point error, false visible points, recovery after occlusion, phase timing error
and coach-rated usefulness. Add ordinary phone recordings, missed lifts,
multi-person scenes, partial attempts and different source publishers. Compare
RTMPose and modern point trackers against these same annotations and licensing
requirements before choosing a heavier stack.

## Checks

```sh
node --import tsx --test tests/video-benchmark.test.ts
node_modules/.bin/tsc --ignoreConfig --noEmit --skipLibCheck --target es2022 \
  --lib esnext,dom --types node --module esnext --moduleResolution bundler \
  --esModuleInterop scripts/video/benchmark/run.ts
```
