# SAM 3.1 video integration

This integration adds object-region evidence to the existing private lift-review
pipeline. It is disabled until `VIDEO_SAM3_URL` and `VIDEO_SAM3_TOKEN` are set on
the application server. Real GPU execution has now succeeded, but plate tracking
and cold-start timing still fail the rollout requirements. See the
[measured test results](../../../docs/sam31-modal-gpu-test-2026-09-12.md).

## What is implemented

- The detailed review pass requests segmentation for its actual evidence frames.
  Sampling retains those source timestamps and adds up to 12 real frames/second,
  capped at 400 frames within the attempt. No synthetic interpolation.
- A CPU gateway authenticates requests before dispatching to an L40S worker.
  The gateway accepts bounded MP4 bytes and geometry, never a user-supplied URL.
  It verifies the clip hash. The decoder checks dimensions, duration and PTS.
- SAM runs separate person and plate sessions, closes both after processing,
  and returns bounded normalized outlines. Temporary clips and frames are
  removed on normal completion and errors; only model weights use a volume.
- Subject selection uses visible torso landmarks. Ambiguous people and competing
  plate tracks are omitted. This is a conservative heuristic, not a validated
  identity or plate-selection model.
- Coach receives candidate object bounds with explicit limitations. The player
  shows outlines only when paused within 12 ms of an observed frame, with an
  on/off control. It does not interpolate across missing masks.
- Region centres are used internally to rank movement, never as bar hubs. SAM
  does not produce velocity, anatomical angles, lift labels or technique scores.
- Timeouts, bad responses and unavailable GPUs retain the existing review path.
  Account cancellation still aborts processing. Worker jobs are bounded at ten
  minutes, with an eleven-minute fencing lease, to accommodate GPU calls.

The existing pose model and manual bar-calibration path remain independent.
Previously saved reviews are not automatically sent to the new processor.

## Pinned upstream versions

SAM source: `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7`.
Checkpoint: `facebook/sam3.1`, revision
`daa63191845a41281374e725f4c9e51c7a824460`, file `sam3.1_multiplex.pt`.

Uses Meta's `build_sam3_multiplex_video_predictor`, with FlashAttention 3 and
compilation disabled initially for a simpler, portable CUDA baseline. Code and
checkpoint are governed by the [SAM License](https://github.com/facebookresearch/sam3/blob/660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7/LICENSE).
The checkpoint is manually gated by Meta on
[Hugging Face](https://huggingface.co/facebook/sam3.1).

## Activation

1. Obtain approval for the SAM 3.1 checkpoint with the intended Hugging Face
   account. Create a read-scoped token for that approved repository. Put it in
   the Modal secret `lift-journal-sam31-hf` as `HF_TOKEN`; never put it in the
   repository, app frontend, chat, shell history or build image.
2. Create a distinct randomly generated server credential of at least 32
   characters. Store it as `SAM3_SERVICE_TOKEN` in the Modal secret
   `lift-journal-sam31-api`, and as `VIDEO_SAM3_TOKEN` on the app server. This
   credential is separate from Hugging Face and OpenRouter credentials.
3. Run the isolated public-fixture GPU smoke test below. Check that the pinned
   weights load, masks actually follow the intended objects, and memory and
   latency fit the limits. Synthetic tests do not prove model accuracy.
4. Deploy `modal deploy scripts/video/sam3/modal_app.py::app`. Set
   `VIDEO_SAM3_URL` to the returned HTTPS ASGI endpoint with `/segment` appended.
   Do not expose this URL or either credential via `NEXT_PUBLIC_*` variables.
5. Deploy the tested website changes, verify anonymous requests are rejected
   before GPU work, and test an authenticated upload with an isolated test
   account. Verify reanalysis, multiple attempts, account isolation, timeout
   recovery and iPhone replay before general activation.

The Modal image mounts only `engine.py` and `gateway.py`, not the repository or
local data. It has no idle GPU minimum and allows one GPU container. The initial
configuration uses a 30-second scale-down window and a 180-second GPU method
timeout. The app bounds each request at 90 seconds; cold-start behavior still
requires real measurement. A timed-out client can leave a bounded GPU call
running until its own timeout.

As checked on 12 September 2026, Modal lists L40S GPU time at $0.000542/second
($1.9512/hour), plus CPU, memory and storage charges. This is a resource rate,
not a measured cost per lift. Configure spending limits before production use.
[Modal pricing](https://modal.com/pricing)

## Verification

TypeScript protocol and replay-evidence tests:

```sh
node --import tsx --test tests/video-sam3.test.ts tests/video-analysis.test.ts tests/video-coaching.test.ts
```

CPU gateway, selection and decoder tests require Python, FastAPI, httpx, NumPy,
OpenCV, FFmpeg and FFprobe. They use synthetic footage and a fake predictor:

```sh
python -m unittest discover -s scripts/video/sam3 -p 'test_*.py' -v
```

An explicit real-GPU test uses a sanitized public MP4 and matching manifest
(`version`, SHA-256, dimensions, last source timestamp as `duration`, up to 48
unique evidence timestamps, and matching torso `anchors`). Running it incurs
GPU usage and sends only that supplied test clip:

```sh
modal run scripts/video/sam3/modal_app.py::smoke --video /private/tmp/public-lift.mp4 --manifest /private/tmp/public-lift-manifest.json --output /private/tmp/sam31-result.json
```

The smoke entrypoint starts an isolated ephemeral Modal app with one L40S,
the same production image and model loader, a 300-second model startup bound,
a 180-second inference bound, and a two-second idle window. The local harness
cancels the call if queueing plus execution exceed ten minutes. It has no HTTP
endpoint and requires only the Hugging Face secret. Its result contains
`segmentation` and separate timing/peak CUDA memory `metrics`; the round trip
includes container startup but excludes image building. Neither coverage nor
successful execution establishes coaching or segmentation accuracy.

Render nine actual source frames and their observed outlines for manual review:

```sh
python scripts/video/sam3/render_preview.py --video /private/tmp/public-lift.mp4 --result /private/tmp/sam31-result.json --output /private/tmp/sam31-preview.png
```

The pinned upstream base predictor passes `offload_state_to_cpu` to a multiplex
initializer that does not accept it. The model loader applies a tested adapter
that accepts only the default false value, preserving GPU state and rejecting
unsupported state offloading. Video-frame offloading remains enabled.

The Hugging Face secret and checkpoint access were verified, and two public
clips completed real GPU inference on 12 September 2026. Local integration
tests remain distinct from model-quality validation. No endpoint deployment
or production activation has occurred; full quality benchmarking is required.
