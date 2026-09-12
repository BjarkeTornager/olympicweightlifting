# SAM 3.1 account-restricted pilot release

12 September 2026. The owner authorized enabling SAM for their account and
publishing the latest application changes to Railway.

Application source: `2ee3007688806bcf84748dfb5ad2da3c8f805653`.
Railway application deployment: `182349db-4346-4707-9b88-65d27be86855`.
Website: <https://lift-journal-production.up.railway.app>.
Modal: <https://modal.com/apps/bjarketornager/main/deployed/lift-journal-sam31>.

## Scope and access

The video worker reads the job owner's account from the database and requires
normal account/Google access plus a verified email matching the single
server-only `VIDEO_SAM3_PILOT_EMAIL`. Other accounts receive no SAM configuration
and never dispatch media to Modal. Empty pilot configuration fails closed;
there is no global environment fallback in the segmentation client or refiner.
The owner account was confirmed to exist, be verified and have Google linkage.

`VIDEO_SAM3_URL` points to the authenticated Modal gateway. Its distinct service
credential was generated in memory and stored directly in the Modal secret
`lift-journal-sam31-api` (`SAM3_SERVICE_TOKEN`) and Railway (`VIDEO_SAM3_TOKEN`).
The Hugging Face token remains only in Modal's separate weights-access secret.
No credential was written to source, logs, browser bundles or this document.

The release includes all committed application changes since the previous
Railway source `d368064a268d8bf656b31f37dda0992f21945aa0`: the video-review updates,
SAM integration, plate-selection fix, queued requests and account restriction.
The exact Git archive excluded private artifacts, local environment files,
dependencies and unrelated untracked work. Infrastructure topology and the
database service were preserved; no new SQL migration was introduced.

## Checks completed before website deployment

- 164 app tests passed, including disposable-database tests and new account-gate cases.
- Type checking, lint and the production build passed locally.
- 12 Chromium/WebKit video access, upload, reanalysis and guided-replay tests passed.
- The prior SAM engine/gateway run passed 17 Python tests, including selection,
  signed receipts, delayed jobs, cancellation, expiry and cleanup.
- On the actual deployed Modal HTTPS endpoint, unauthenticated POST, GET and
  DELETE returned 401 with no-store; authenticated malformed input returned 400.
- A public clean-and-jerk fixture passed through the actual TypeScript client,
  production gateway and L40S worker: 131/131 sampled frames had plate outlines.
  Total round trip was 76.566 seconds; submission 1.854 seconds; 28 polls with
  a maximum 1.827 seconds. No private videos or LLM coaching calls were used.

GitHub authentication was unavailable for pushing this commit, so no new
GitHub-hosted CI result is claimed. Railway receives the exact local source
archive directly. The older source's GitHub checks were successful; they do not
validate this release. The local commit remains available for a later push.

## Live verification

Railway deployment `182349db-4346-4707-9b88-65d27be86855` completed with
**SUCCESS**, including its `/api/ready` health gate. A read-only check inside the
running container confirmed the new account-gate code, matching pilot email,
SAM endpoint/service credential and enabled video worker. The requested owner
is the verified Google-linked account selected by this configuration.

Live health/readiness returned 200. Anonymous session checks returned no user;
anonymous journal and video APIs returned 401 with no-store. Twelve checks
against the hosted bundle passed across Chromium and WebKit, including private
access, upload navigation, reanalysis, enlarged replay and observed object
outlines. Product flows intercepted every account API with synthetic data;
security probes were unsigned. No production account records were created,
modified or reanalysed during these tests. Desktop WebKit is not a physical
iPhone test.

The production Modal endpoint smoke test used only the public fixture. All GPU
containers had scaled down to zero after verification.

## Use and rollback

After release, reload the website and upload a lift, or open **Correct lift &
reanalyse → Reanalyse saved video** on an existing review. Object outlines appear
when paused at an observed frame. Existing analyses are not automatically
reprocessed. Coach feedback remains available when optional GPU analysis fails.

To stop new SAM dispatches, clear `VIDEO_SAM3_PILOT_EMAIL` and redeploy the
application. Keep the service credential private. The Modal worker has zero
minimum idle GPUs, a one-container cap, a 30-second scale-down window and bounded
execution. The app shares a five-minute GPU allowance across attempts, with a
cutoff that leaves time in its overall ten-minute video-job window.

This is a small pilot. Two public debugging clips and the deployed-endpoint
smoke test establish functional execution, not general mask accuracy, physical
bar-speed accuracy or improved coaching quality. Physical iPhone checks and
more camera angles remain part of evaluating the pilot.
