# Private lifting video analysis

## Product flow

Open **Coach → attachments → Review lifting video**, or **Train → Lifting coach → Review lifting video**. Upload an MP4/MOV/WebM of up to 50 MB and two minutes, select 0.5–20 seconds and the lift, and choose **Upload & analyse lift**. Load and bar calibration are optional. No typed question is required. Keep the window open until the upload is acknowledged; processing then continues across navigation, closed tabs and server restarts. Reopen **Your reviews** for status, playback, Coach feedback, retry, download, analysis export or deletion. Chat drafts and workouts are untouched.

FFmpeg prepares a silent, rotation-corrected H.264 selected clip and 48 labelled samples in eight contact sheets. The existing image-capable Coach provider first receives the sheets without the selected lift label to describe visible phases. A server-side sequence check distinguishes clean/front-rack/jerk from a continuous pull to overhead; uncertain, contradictory, missing or invalid phase evidence withholds lift-specific coaching. A supported identification permits a second read-only coaching call. A response that names an incompatible lift is withheld. Both calls retain the configured provider/privacy policy. It gets no mutation tools, account identifiers, private URLs or original video/audio. Feedback covers visible strengths, one main improvement and one next-attempt cue/check. The `lifting_videos` tool lets normal Coach conversations retrieve the signed-in person's saved reviews and measurement summaries.

The existing **Use on-device frame review** remains available and keeps the source local, using the existing Coach message queue and Activity image catalogue.

## Optional bar measurements

Use a fixed side-on camera. On the selected start frame mark the plate centre, match the circle to its diameter and supply its actual diameter in centimetres. OpenCV performs template matching around the user-selected plate across every decoded frame, using a fixed reference template, bounded search and a match threshold. It stops at the first lost match or timestamp gap; it does not jump to a different object to complete a trajectory. A lost track can be shown as a partial overlay, but physical summary metrics and velocities are withheld.

A complete track supplies estimated horizontal range and rise from the start. Velocity requires the user's explicit real-time/no-speed-edit confirmation and a median frame interval of at most 21 ms (approximately 50 fps). No assumption is made from a file's nominal frame rate about slow-motion capture timing. Velocity is a central difference over approximately 100 ms; the displayed peak is the maximum of this smoothed series, not an instantaneous peak. There are no force, power, 3D, joint-angle, injury-risk, competition-judging or technique-score outputs.

These are **experimental 2D estimates, not validated biomechanics**. Tracking confidence is a template similarity statistic, not calibrated probability. Similar-looking backgrounds, plate rotation, motion blur, perspective, vibration, occlusion and a wrong seed/scale can cause plausible-looking errors. Users must inspect the overlay. Before coaching prescriptions depend on these metrics, validate with consented real lifting footage, manual annotations and suitable reference equipment. Synthetic tests are software checks, not validation of coaching quality or athlete measurement accuracy.

## Persistence and privacy

`lifting_videos` uses a composite (user_id, id) key and an account cascade. All client routes require an authenticated, invited account plus the pinned account header; mutations also require the trusted Origin. There are no public video URLs. Playback is fetched with the account header to a revocable local blob URL; the media endpoint also supports single byte ranges. API/media responses are private/no-store and excluded from the service worker. Original filenames are not stored or passed to subprocesses.

The binary upload is bounded while reading (50 MB). Upload IDs plus SHA-256 of bytes and canonical metadata make response-loss retries idempotent. Actual container headers are checked; the decoder accepts bounded supported video containers/codecs with only local file/pipe protocols. Scratch directories are private, filenames server-generated, subprocess arguments never run through a shell, and scratch data is removed in finally. Timeouts, output-size, pixel and frame-count limits bound decoding. Termination also stops active FFmpeg subprocess groups.

The source bytes are stored privately in PostgreSQL until video processing succeeds. Then the original upload is removed and replaced by the selected silent clip, contact sheets and analysis. A model failure retains processed output for retry without redecoding. A decoding failure retains the private source until retry or deletion. Source bytes may contain original metadata while pending; derived media strips audio, location and other copied metadata. Twenty reviews or 500 MB per account, three active uploads, request rate limits and reserved processing headroom bound storage. Clips and analysis export separately from journal JSON backups. Deletion removes the review, media, sheets and feedback; any old copies separately exported or quoted into chat are independent.

## Worker and deployment

Migration `0006_acoustic_sister_grimm.sql` adds the table. `instrumentation.ts` starts one non-blocking poller per persistent Node process when `VIDEO_ANALYSIS_WORKER=1`. PostgreSQL `FOR UPDATE SKIP LOCKED` claims jobs with a seven-minute lease and a random fencing token. Work has a six-minute deadline, and every write requires the owner, ID and current token. Expired leases can recover up to three attempts. Completed preprocessing is checkpointed before inference. User revocation/deletion is checked before sending to the provider and during processing. Deletion/fencing prevents an old worker resurrecting a result. This is for the persistent Railway Node service, not an ephemeral serverless runtime.

The runtime Docker image installs distribution FFmpeg/FFprobe, Python, NumPy and OpenCV. `VIDEO_ANALYSIS_WORKER=1` and `VIDEO_PYTHON_PATH=/usr/bin/python3` enable it there. Local/tests default to disabled; explicitly enable only with a disposable test database when testing background execution. Optional operator paths `FFMPEG_PATH`, `FFPROBE_PATH` and `VIDEO_PYTHON_PATH` aid local verification. Provider settings and privacy filters are unchanged. No new cloud service, sensor or paid-model benchmark was added.

## Verification

- Python end-to-end synthetic clips exercise actual encoding/decoding, 120 original-timed frames, eight sheets, known displacement/velocity, occlusion and unconfirmed timing. CI installs Linux FFmpeg/OpenCV and runs these tests.
- Database tests cover owned reads/media/deletion/retry, duplicate IDs, source removal after processing, read-only model inputs, provider retry without redecoding, abandoned leases, stale worker fencing and deletion during inference.
- Browser tests cover upload without chat text, exact uploaded file bytes, cross-page persistence, saved playback, feedback, overlay, JSON export, deletion, failed-upload retries with a stable ID, optional calibration and accessibility/mobile layout. Existing on-device review tests remain.
- All test media/accounts/model responses are synthetic. No paid provider calls or real athlete data are used for verification.

Primary implementation references: [FFmpeg](https://ffmpeg.org/ffmpeg.html), [FFprobe](https://ffmpeg.org/ffprobe.html), [OpenCV template matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html), [Kinovea calibration](https://www.kinovea.org/help/staging/measurement/calibration.html). The implementation is original and these sources do not validate the app's measurements.


## Lift-identification correction

The first upload form defaulted to Snatch. That label could anchor a review of a clean & jerk. The new default is **Identify from video**, and the first visual pass receives neither the selected lift nor the reported load. Phase order and actual sampled frame indices are validated before a lift name is derived. A front-rack catch followed by a separate rack drive and overhead receipt is never classified as a snatch. A final overhead frame alone is insufficient evidence of a snatch. These are conservative evidence checks, not validated computer vision or calibrated confidence scores.

Existing saved reviews offer **Correct lift & reanalyse**. The owner can select a movement or automatic identification and replace feedback from the existing saved frames without another upload. Original upload idempotency, media, tracking and journal records are preserved. Older clips retain their 24 cached frames; newly uploaded clips use 48. Missing visual evidence still withholds advice even when a lift is explicitly selected. The UI never treats a selected lift label as verified identity. No migration is required: phase evidence is stored in the existing analysis JSON. Failed coaching retries reuse the phase checkpoint; an explicit reanalysis clears that checkpoint.

Recognition and coaching remain experimental. Synthetic regression tests cover the reported label-conflict scenario, clean/jerk/snatch sequences, sparse/contradictory evidence, invalid timestamps, owner-only correction, stale-worker fencing and correcting a saved clip through the UI. They do not establish real-athlete or live-model accuracy. No paid model evaluations or personal media were used during implementation.

Technique definitions were checked against [Catalyst Athletics' snatch description](https://catalystathletics.com/exercise/58/Snatch/) and [clean and jerk rack positions](https://catalystathletics.com/article/1874/The-Clean-and-Jerk-Rack-Positions/).
