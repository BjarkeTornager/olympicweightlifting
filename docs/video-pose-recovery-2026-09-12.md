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
