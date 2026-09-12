# Recover tracking after missed body detections

The follow-up reported two failures. Read-only checks found the saved reviews
complete and no new worker failure events. The open review displayed observations
without correction markers. The exact error-message clarification was requested;
no additional crash is claimed to have been reproduced.

An additional defect was reproduced in the tracking path. After a missed-detection
gap longer than 0.5 seconds, `SubjectTracker` rejected every subsequent frame
without ever updating its last accepted time. This permanently disabled body
landmarks for the remainder of the clip and deprived SAM's subject selector of
independent torso anchors.

An isolated CPU probe on the owner's saved clip, running inside Railway and
deleting temporary media afterward, found 94 independently detectable foreground
frames out of 160 sampled frames. The original continuity logic retained only two.
The revised logic retained 70, including observations near the end. These counts
measure available observations, not landmark accuracy or coaching quality.

Recovery requires multiple consistent body observations near the previous torso
or feet. Longer gaps require agreement of both a visible shoulder–hip pair and
foot geometry across three observations. Confirmation follows the moving candidate
between consecutive frames. It does not select the largest remaining spectator,
fill gaps, infer hidden joints, or derive speed from body markers. Ambiguous
candidates and unsupported observations remain omitted.

Private refinement checkpoints are versioned so retries do not reuse the old
tracking result. Ready reviews stay unchanged until explicitly reanalysed.

The replay now explicitly explains missing object outlines and missing correction
markers. It no longer offers a Coach-overlay checkbox when there are no cues to
display. Existing observations and playback remain available.

Validation: foreground continuity/recovery regression tests passed, including
moving confirmation, missing confirmations, displaced subjects and competing
subjects. The video Python suite passed eight tests, with two local skips for
Linux sandbox/model setup; the isolated production CPU probe used the actual
model. All 167 Node tests and 14 Chromium/WebKit video tests passed. Production
verification is recorded after release.

## Release

Railway deployment `aa46ed8e-2816-45b1-9961-5205715a38b9` succeeded from source
`fe2b802dd2716bcb95fc5cfc2b06cac123c2dd28`. Deployed code and private pilot settings
were verified. All 14 hosted Chromium/WebKit video checks passed, including the
new limited-review explanation and unsigned/foreign-origin access protections.

The exact tracked-source archive was deployed directly to Railway. GitHub's
previously identified authentication issue remains; no new GitHub CI run is
claimed. Credentials, private artifacts and the unrelated routing draft were
excluded. One saved owner clip was reanalysed to verify the complete path;
other saved reviews were not changed.

The live run finished `ready` without error. SAM returned athlete outlines in
209 of 212 sampled frames, and Coach saved one timestamped correction moment.
A private, exact-evidence-frame preview was inspected: its outline followed the
foreground lifter while excluding the spectators and the occluding weight plate.
The temporary preview was then deleted. The private refinement checkpoint was
cleared on completion.

Plate outlines were still unavailable (zero frames), so this run does not validate
plate/bar tracking or speed measurement. The final result and this limitation
were reported separately; completed execution is not equated with perfect tracking.
