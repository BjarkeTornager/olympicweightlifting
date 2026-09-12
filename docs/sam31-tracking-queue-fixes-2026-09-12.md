# SAM 3.1 plate selection and queued execution fixes

Date: 12 September 2026. Follow-up to the [initial GPU test](sam31-modal-gpu-test-2026-09-12.md).

## Root causes and changes

Raw candidate diagnostics from real Modal inference isolated the plate failure:
SAM already detected the lifting plates. The snatch had two moving plate IDs;
the clean & jerk had three (both ends plus a stacked plate). The old selector
rejected all of them because their movement scores were similar. Background
object-cap warnings were present in the clean & jerk, but did not prevent those
three lifting plates being detected in this test.

The selector now checks whether the competing plate tracks move coherently.
It allows perspective-scaled vertical travel and stacked plates, then chooses
one consistently visible plate ID, preferring unclipped observations. A moving
region must also move relative to the athlete. Unrelated motion, camera pan
alone, uncertain athlete identity and incoherent candidates still lead to
abstention. These are conservative association heuristics, not a trained plate
identity classifier. Centres used for selection are never exported as bar-hub
coordinates or physical measurements.

The synchronous 90-second GPU request is replaced by authenticated submission
and short GET polls. The gateway returns an HMAC-signed receipt bound to the
request nonce, source hash, Modal call and expiry. Receipts stay on the app
server. Every submit, poll and cancellation requires the service credential;
a different nonce or tampered receipt cannot read or cancel a call. No request
follows redirects or accepts arbitrary result URLs.

The worker shares a maximum five-minute GPU allowance across all attempts and
stops optional GPU waiting at minute eight of its ten-minute job deadline,
leaving two minutes for remaining review work. Individual requests are bounded
(60 seconds for upload, 30 seconds for reads). Read failures can retry the same
call; uploads are not automatically retried after ambiguous failures. Account
cancellation, expiry or failed polling triggers a separate bounded DELETE.
The GPU rejects work whose queue deadline has already passed before inference.
No idle GPU minimum was added.

A signed receipt survives a gateway restart. The app does not persist these
receipts across its own process restarts: its existing fenced video-job retry
can start a new segmentation call. If the upload response is lost before its
receipt arrives, immediate cancellation cannot be guaranteed; the queue
expiry check and 180-second GPU execution bound limit remaining work. This is
not an exactly-once execution claim.

## Real GPU rerun

The same pinned SAM source, checkpoint, L40S GPU, sanitized public fixtures and
actual source timestamps were used. No private uploads, journal data or LLM
coaching calls were used. `queued_smoke` exercised the actual FastAPI contract
through local ASGI requests backed by remote Modal spawn/get calls; it did not
expose or test a public Modal HTTP endpoint.

| Measurement | Clean & jerk | Snatch |
| --- | ---: | ---: |
| Sampled frames | 131 | 82 |
| Plate frames before selector fix | 0 | 0 |
| Plate frames after fix | 131 | 82 |
| Person frames after fix | 129 | 72 |
| Model load | 20.582 s | 19.912 s |
| Decode, inference and selection | 37.325 s | 20.685 s |
| Total queued round trip | 65.240 s | 58.151 s |
| Submit request | 0.849 s | 0.695 s |
| Poll requests | 30 | 27 |
| Longest poll | 1.464 s | 0.980 s |
| Peak allocated CUDA memory | 22.947 GiB | 21.984 GiB |

Runs: [clean & jerk](https://modal.com/apps/bjarketornager/main/ap-ZDe97zwaczgWJSxUNMe1WF),
[snatch](https://modal.com/apps/bjarketornager/main/ap-qvzJffKsrV4NSFoECbMhJu).
Sources: [Catalyst Athletics clean & jerk](https://www.youtube.com/watch?v=bNCXgyosXlc),
[snatch](https://www.youtube.com/watch?v=HuLNhAsQY7A).
Fixture intervals and provenance are unchanged from the initial test report.

Nine source frames per clip were rendered and visually reviewed. The chosen
plate remains on the lifted bar across those inspected frames; stored background
plates are not selected. Body outlines still sometimes omit disconnected body
parts, and the snatch has ten frames without a selected person. Plate coverage
is not a mask-accuracy score, and this two-clip debugging set is not an independent
quality benchmark. These changes do not validate velocity or coaching accuracy.

## Verification and rollout status

- 17 Python tests: decoder cleanup, subject/plate selection, camera pan and unrelated
  motion, auth before dispatch, tampered/cross-request receipts, cancellation,
  expiry, and a simulated 240-second cold start across gateway restart.
- 163 repository tests passed, including disposable database isolation tests.
- Type checking, lint, production build and diff checks passed.
- Real rerun responses retained the strict source hash, timeline and geometry contract.
- All isolated SAM test apps stopped with zero tasks after testing.

Raw diagnostics, JSON results and visual previews are under
`/private/tmp/lift-sam31-smoke/`, outside version control. The production response
never includes the diagnostic candidate dump. Modal may retain function inputs
and outputs according to its platform retention; the application's temporary
GPU files are removed and its persistent volume contains weights only.

The fixes are implemented and tested. SAM remains disabled on the live website
until its separate service credential, endpoint and website release are activated.
Existing saved reviews are not automatically reprocessed.

Protocol reference: [Modal's polling recommendation](https://modal.com/docs/guide/webhook-timeouts).
