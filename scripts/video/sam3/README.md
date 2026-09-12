# SAM 3.1 video integration

This integration adds object-region evidence to the existing private lift-review
pipeline. It is disabled until `VIDEO_SAM3_URL`, `VIDEO_SAM3_TOKEN` and
`VIDEO_SAM3_PILOT_EMAIL` are set on the application server. Only the matching
verified account can dispatch SAM jobs; blank pilot email fails closed. The
account is read from the fenced database job, never from upload fields. Real GPU tests now retain plate outlines on both public
fixtures, and requests use queued submission/polling. See the
[fixes and measured results](../../../docs/sam31-tracking-queue-fixes-2026-09-12.md).
This small debugging set does not establish general segmentation accuracy.

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
- Subject selection uses visible torso landmarks. Coherent motion can associate
  two bar ends and stacked plates; one consistently visible plate is selected.
  Incoherent competing tracks and ambiguous people are omitted. This is a
  conservative heuristic, not a validated identity or plate-selection model.
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
   Set `VIDEO_SAM3_PILOT_EMAIL` to the single verified pilot account. Removing
   that email disables new SAM dispatches without changing normal coaching.
   Do not expose this URL or either credential via `NEXT_PUBLIC_*` variables.
5. Deploy the tested website changes, verify anonymous requests are rejected
   before GPU work, and test an authenticated upload with an isolated test
   account. Verify reanalysis, multiple attempts, account isolation, timeout
   recovery and iPhone replay before general activation.

The Modal image mounts only `engine.py` and `gateway.py`, not the repository or
local data. It has no idle GPU minimum and allows one GPU container. The initial
configuration uses a 30-second scale-down window and a 180-second GPU method
timeout, plus a 300-second startup bound. Authenticated POST submission returns
202 and a signed receipt; GET polls and DELETE cancellation use that receipt
and the same random request nonce in headers. The service token is required
for every method. No raw Modal call ID or receipt reaches the browser.

The app persists the signed receipt in its private, account-fenced evidence
checkpoint before polling. Each worker waits for up to 90 seconds, then queues
itself to resume the same GPU job after 15 seconds. Waiting does not consume the
three failure-retry attempts. The GPU receipt expires after 15 minutes; it is
bound to the source bytes, exact evidence manifest and configured destination.
No receipt is returned to the browser or Coach. Evidence is saved before GPU
dispatch so a process restart can reuse it without decoding or uploading again.

POST is bounded at 60 seconds and GET at 30 seconds. Only reads retry after
transport failures. Cancellation uses an independent five-second request.
A lost submit response (or a crash before its receipt is persisted) can still
leave a call running; the queue-expiry check and 180-second inference timeout
bound that work. This is not an exactly-once submission guarantee.

An expired service job is distinguished from a completed segmentation with no
confident subject match. The UI labels incomplete reviews explicitly and does
not describe missing coaching markers as proof of correct technique.

Detailed frame selection now fills gaps throughout the detected movement
window, retaining phase anchors and full-clip context. It does not spend all
remaining samples clustered around already-known poses. A synthetic clean &
jerk transition regression verifies gaps of no more than 0.25 seconds in the
test's rack-to-overhead interval. This is a sampling check, not proof of model
accuracy or of capturing every rapid transition in an arbitrary clip.

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
`segmentation`, diagnostic raw candidate polygons (test only), and separate
 timing/peak CUDA memory `metrics`; the round trip
includes container startup but excludes image building. Neither coverage nor
successful execution establishes coaching or segmentation accuracy.

To test the queued contract locally against a real remote GPU, install Modal,
FastAPI and httpx in a temporary local environment and run:

```sh
python -m modal run scripts/video/sam3/modal_app.py::queued_smoke --video /private/tmp/public-lift.mp4 --manifest /private/tmp/public-lift-manifest.json --output /private/tmp/sam31-queued-result.json
```

This uses an ephemeral local service token and ASGI requests; no production
secret or public endpoint is created. It records submit/poll timings and cancels
unfinished work when its five-minute deadline is reached. The public-fixture
harness is distinct from production HTTP and account-isolation verification.

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
tests remain distinct from model-quality validation. The service and an
owner-only website pilot are now deployed; see the
[pilot release record](../../../docs/sam31-pilot-deployment-2026-09-12.md).
Broader quality benchmarking is required before widening the pilot.
