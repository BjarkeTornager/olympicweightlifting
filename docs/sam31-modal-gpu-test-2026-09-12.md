# SAM 3.1 real GPU test — 12 September 2026

The runtime integration now works on Modal, but the current configuration is
not ready for general activation. Two public lifting clips completed real SAM
3.1 inference on an NVIDIA L40S. Athlete outlines generally followed the lifter;
the final pipeline returned no plate outlines in either clip. Both cold round
trips exceeded the application's current 90-second SAM request timeout.

## Inputs and measured results

These are the existing silent, sanitized public fixtures from
[the diagnostic benchmark](lift-video-benchmark-2026-09-12.md), with the same
production timestamps and available torso landmarks. No private user videos,
account data, journal records or OpenRouter calls were involved.

| Result | Clean & jerk | Snatch |
| --- | ---: | ---: |
| Fixture | clip-01 | clip-03 |
| Last source-frame timestamp | 7.383 s | 3.633 s |
| Source dimensions | 960 × 540 | 762 × 960 |
| Frames sent through each SAM concept pass | 131 | 82 |
| Frames with a selected athlete outline | 129 | 72 |
| Frames with a selected plate outline | 0 | 0 |
| Model loader time | 20.683 s | 21.049 s |
| Inference, decoding and postprocessing | 34.235 s | 21.635 s |
| Full call round trip including startup/queueing | 97.925 s | 236.803 s |
| Peak allocated CUDA memory | 22.947 GiB | 21.984 GiB |
| Peak reserved CUDA memory | 25.662 GiB | 24.293 GiB |

Coverage counts describe returned outlines, **not accuracy**. Neither clip has
independently annotated segmentation ground truth. Nine exact source frames per
clip were inspected with the returned outlines. The athlete was generally the
intended subject, but missing body regions and gaps remained. These outlines
cannot support precise anatomical angles or assertions about joint positions.

Public sources:

- [Catalyst Athletics: Clean & Jerk](https://www.youtube.com/watch?v=bNCXgyosXlc),
  source interval 8.0–15.4 seconds.
- [Catalyst Athletics: Review 2 — Snatch](https://www.youtube.com/watch?v=HuLNhAsQY7A),
  source interval 11.6–15.25 seconds, with the existing crop and narrator mask.

Completed Modal runs:

- [Clean & jerk](https://modal.com/apps/bjarketornager/main/ap-YUc6B70J59paNX12u3QGhh).
- [Snatch](https://modal.com/apps/bjarketornager/main/ap-Q1ghPljuPV5VN4RfI4eT1K).

Modal's app-specific Usage page reported **US$0.04** for the completed clean-and-
jerk run at the time of inspection. This is a rounded dashboard value, not the
total experiment bill; earlier troubleshooting, the snatch run and persistent
weight storage are separate. No credit purchase or billing changes were made.

## What the real test fixed

1. Modal image environment steps must precede `add_local_file` mounts. The
   original order failed during image resolution. Both GPU and gateway image
   definitions now use the correct order.
2. The isolated test must ship its model configuration as well as its entrypoint.
   It now lives in the same module as production, under a separate ephemeral
   `smoke_app`, and uses the same image and loader. It exposes no HTTP endpoint
   and does not require the production API secret.
3. The pinned upstream base predictor forwards `offload_state_to_cpu`, but its
   multiplex model initializer does not accept that argument. A small adapter
   permits the default false value, preserves video-frame offloading, and
   explicitly rejects unsupported state offloading. A CPU regression test
   covers this behavior. See the pinned
   [base dispatcher](https://github.com/facebookresearch/sam3/blob/660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7/sam3/model/sam3_base_predictor.py)
   and [multiplex initializer](https://github.com/facebookresearch/sam3/blob/660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7/sam3/model/sam3_multiplex_tracking.py).
4. Test metrics convert PyTorch's version object to a plain string so the local
   caller can read results without installing PyTorch.

The isolated harness now also cancels after ten minutes of queueing/execution.
The two successful measured runs used the earlier direct-call form; the new
cancellation guard does not change model settings or the measured output.

## Release decision

Keep production SAM processing disabled until the remaining gaps are addressed:

- **Plate selection:** the final selection pipeline emitted no plate tracks.
  The cluttered clean-and-jerk clip also repeatedly hit the eight-object limit
  while detecting dozens of background plates. These observations do not isolate
  the cause: detector capacity, candidate selection and conservative ambiguity
  rejection need separate diagnostics. Athlete/hand-guided plate detection and
  explicit selection of the intended bar end are better next experiments than
  treating any mask centre as a bar hub.
- **Startup:** inference itself completed within 35 seconds, but cold round
  trips varied from 98 to 237 seconds. Test a durable asynchronous job/polling
  path or validated startup strategy against the existing request and job
  deadlines before activation. These measurements are not a warm latency SLA.
- **Coaching:** no lift-classification accuracy, technical recommendation,
  trajectory, velocity or biomechanical accuracy was established by this test.
  Those require separate evidence and evaluation.

The source revision remains `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7`, with the
compatibility adapter described above. Weights are `facebook/sam3.1` at revision
`daa63191845a41281374e725f4c9e51c7a824460`. PyTorch was `2.10.0+cu128`;
FlashAttention 3, real-valued RoPE and compilation were disabled.

## Verification and retained evidence

- Both real responses passed the production segmentation schema, source hash,
  dimensions, timestamp order and duration checks.
- 11 CPU gateway/decoder/selection/compatibility tests passed.
- 18 TypeScript segmentation/analysis/coaching tests passed.
- All six ephemeral test apps were checked after completion; all were stopped,
  and `modal container list` returned no live containers. The model-weight cache
  remains in its dedicated Modal volume for future use.
- Production endpoint deployment, website activation, authenticated HTTP end-to-
  end testing and iPhone testing of real SAM masks have not been performed.

Raw results, logs and local contact sheets are in
`/private/tmp/lift-sam31-smoke`, outside the repository. Public source footage
and derived previews are not committed or published. Reproduce using the
[SAM setup and test guide](../scripts/video/sam3/README.md) and
`scripts/video/sam3/render_preview.py`.
