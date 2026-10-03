# Diagnostic tracing (MLflow)

Lift Journal can send diagnostic traces to a self-hosted MLflow, to find slow or failing replies. A trace holds metadata only: timings, models, token counts, cost, routing, skills, tool names, change kinds, counts, settings, status and error categories. It never holds messages, Coach's replies, the system prompt, journal entries, transcripts, tool inputs or results, search queries, photos or what a photo shows, video frames or feedback. Accounts appear only as an HMAC code.

Tracing is **off** unless `TRACING=metadata`. Off is also the kill switch for capture: nothing in `lib/tracing` loads OpenTelemetry, no provider is created and no trace is sent. Deletion is separate and keeps running while `MLFLOW_TRACKING_URI` and `MLFLOW_EXPERIMENT_ID` are set, whatever `TRACING` says, so the traces already sent still expire and are deleted with their account. To cut MLflow off entirely, unset those two as well, but only once the older traces are gone.

The privacy page describes traces as built (How we measure use). Setting up the production service, and the order to switch it on in, is in [tracing-setup.md](tracing-setup.md).

## What is traced

Each unit of work is one trace, with a root span and children:

| Root | When | Children and what the root records |
|---|---|---|
| `coach_turn` | Each Coach turn, typed or from the iPhone in the background | `prepare` (and `photos_sorted`), `route` (Jev's tokens), one `round` per model round, one `chat` per provider call (including a call the content filter blocked), one `tool.<name>` per tool, `commit`. Status, rounds, tools, skills, change kinds, total cost. The trace id is saved in the turn's metrics as `traceId` |
| `image_tag` | Each tagging run of a photo | One `chat`. What started it (`upload`, `upload_background`, `retag`, or `retry` by the sweeper), whether it worked, how many tags and whether it was confident. Never the category or the tags |
| `voice_setup` | Each `voice/session` request, a call's start or resume | `context` and `mint_token` (Gemini) or `signed_url` (ElevenLabs). Provider, purpose, language, resumed, whether the app draws cards, the instruction's length, and the HTTP status of a refusal (429 for a limit) |
| `voice_tool` | Each `voice/action` request | The tool's name, whether it worked and saved |
| `voice_socket` | Each `voice/event` report | The event, close code, reconnect attempts and whether it resumed. The reason's text stays in the log only |
| `voice_tidy` | Each transcript tidy, when a call ends (`final`) or the Coach thread catches up (`catch_up`) | One `chat` per chunk of 80 lines, with a failed chunk's status. Lines and chunks counts |
| `video_job` | Each attempt at a video review | `process_video`, `identify` (with its `chat`), `refine`, `sam3`, `overlay_recovery`, one `review` per pass (with its `chat`, whether it validated and the fixed reason it did not), `body_reconstruction`. The attempt number, the furthest phase and the outcome: `done`, `requeued`, `waiting` (for the GPU), `failed` or `stopped` |

Traces are grouped into MLflow sessions by HMAC codes as well: a Coach day (the account and the athlete's local date), a voice call, a video's attempts and a photo's tagging runs. A call's tidy always has its call's code, from the transcript's id. `voice/session`, `voice/action` and `voice/event` accept an optional `callId`, that same id, which puts their traces in the call's session too. Today the apps send it only with cards (`show_card`); sending it with every voice request is a later change to the website and iPhone clients, after this server version is deployed, since older servers reject unknown fields.

The live conversation between the phone and Gemini or ElevenLabs never reaches the server, so it isn't traced. Reminders, the weekly review and read-only work are not traced either.

## How it works

- `lib/tracing` is the only code that may import `@opentelemetry/*` (a test enforces it), and only `provider.ts` does at run time. It is loaded on the first traced unit of work.
- The tracer provider is never registered globally, so Next.js keeps its own spans off and our spans don't nest under them. Spans go over OTLP/HTTP JSON to `${MLFLOW_TRACKING_URI}/v1/traces`.
- Every attribute key has a validator in `attributes.ts`: a number, a boolean, a value from a fixed list or a short slug. Anything else is dropped and counted in `lift.dropped_attrs`. A tool span is `tool.<name>` only for a tool Coach has, otherwise `tool.unknown`.
- Errors are recorded only as their `errorCategory` (`lib/error-log.ts`) and, for an HTTP error, its status.
- `traced()` in `spans.ts` runs a unit of work as its own trace, and `timed()` times one step as a child span. Both catch their own errors: tracing never fails or slows a request.
- On SIGTERM Next.js exits as soon as the last open request closes, before the batch timer would send the spans that request ended with. So during that drain each root waits up to half a second for its trace to be sent before it returns (`settle` in `spans.ts`).

## Deletion and retention

- **Retention.** Traces past `TRACE_RETENTION_DAYS` (at most 30, as the privacy page says) are deleted every six hours by the janitor that `instrumentation.ts` starts, a minute after each server starts. Each sweep logs `trace_retention` with the number deleted, or `trace_retention_failed` with the category and MLflow's status. MLflow's own archival never deletes anything.
- **Account deletion.** `DELETE /api/account` computes the account's code and, once the deletion has been answered, `after()` deletes every trace with that code (`deleteAccountTraces` in `admin.ts`). It logs `account_traces_deleted` with the count, or `account_traces_delete_failed` with the category and status. It is best effort: a failure never fails the account's deletion, and the retention sweep removes what is left within 30 days.
- Both use `traceAdminConfig`, which needs only the MLflow variables: with `TRACING=off`, or a capture variable that is invalid, they still run. An invalid `TRACE_RETENTION_DAYS` falls back to 30 for deletion. Both delete only in `MLFLOW_EXPERIMENT_ID`.
- **Clear conversation** doesn't delete traces: they hold no messages, and expire on their own.
- The app's MLflow user needs **MANAGE** on the experiment: EDIT can send and search traces, but every deletion is refused with 403 (`"status":403` in the log lines above).
- Deleted traces may stay in Postgres backups until those expire, as the privacy page says.

## Opening the UI

The production MLflow has no public domain. With the Tailscale subnet router running (see [tracing-setup.md](tracing-setup.md)) and Tailscale on, open `http://mlflow.<alias>:5000`, the host name the router's boot log prints for the project, such as `http://mlflow.olympicweightlifting-production-railway.internal:5000`, and sign in as `admin`. Then Experiments, `lift-journal-production`, Traces.

- To find a reported problem, take the incident code from the athlete's error message (`lift.incident` on the root), or a turn's `metrics.traceId` from `agent_turns`, and search for it.
- To see one account's traces, compute its code (`userCode` in `lib/tracing/ids.ts`) and filter on the user column. With the production secret read into the shell (`read -rs TRACE_USER_SECRET; export TRACE_USER_SECRET`):

  ```
  node -e 'console.log(require("crypto").createHmac("sha256", process.env.TRACE_USER_SECRET).update("user:" + process.argv[1]).digest("hex").slice(0, 32))' <account id>
  ```
- Cost: MLflow adds its own estimate from the model names. It is not the bill; `lift.cost_usd` on chat spans and `lift.cost_usd_total` on Coach roots are what OpenRouter charged.

## Environment

On the app (`lift-journal`):

| Variable | Meaning |
|---|---|
| `TRACING` | `off` (default) or `metadata` |
| `MLFLOW_TRACKING_URI` | MLflow's base URL: `http://mlflow.railway.internal:5000` in production, `http://127.0.0.1:5001` locally |
| `MLFLOW_EXPERIMENT_ID` | The experiment traces go to. The janitor and account deletion look only in this one, so before changing it, delete the old experiment's traces |
| `MLFLOW_TRACKING_USERNAME`, `MLFLOW_TRACKING_PASSWORD` | Basic auth: the `lift-app` MLflow user |
| `TRACE_USER_SECRET` | HMAC secret for account and session codes; at least 32 characters in production. Don't rotate it: older traces could then only expire, not be deleted with their account |
| `TRACE_SAMPLE_RATE` | Share of units of work traced, 0 to 1 (default 1) |
| `TRACE_RETENTION_DAYS` | 1 to 30 (default 30) |
| `NEXT_OTEL_FETCH_DISABLED` | `1`: keeps Next.js's own fetch spans, whose URLs can carry keys and place names, off should a global tracer ever be added |
| `TRACE_CONTENT` | `1` adds message text, with images as `[image]`, only when `NODE_ENV` isn't production, the database name ends in `_test` and MLflow is on localhost. For synthetic eval and bench accounts. Never set it on Railway |

A missing or invalid variable turns capture off with one `tracing_disabled` log line naming the reason. Failed exports log `tracing_export_failed` at most every ten minutes and slow a unit of work only during a drain, by half a second at most. All of these are kept by `.railway/railway.ts` with `preserve()`, so applying the Railway config never deletes them.

The MLflow service's own variables are in [tracing-setup.md](tracing-setup.md).

## Upgrading MLflow

MLflow had two CVEs in 2026 that needed no login; watch its [security advisories](https://github.com/mlflow/mlflow/security/advisories) and upgrade when one applies.

1. Read the release notes between the pinned version and the new one, for changes to OTLP ingest, trace search, `delete-traces` or basic auth.
2. Check the new version locally first: change the tag in `infra/mlflow/Dockerfile`, run it as in [Local MLflow](#local-mlflow), send a few traces with `TRACING=metadata`, and run `npm test` (the deletion tests mock MLflow, so also delete a test account's traces against the local server).
3. Back up the production databases: in a shell with Railway's Postgres URL, `pg_dump -Fc -d mlflow -f mlflow.dump` and the same for `mlflow_auth`.
4. Migrate the schema: from the `mlflow` service's shell (`railway ssh`), run `mlflow db upgrade "$MLFLOW_BACKEND_STORE_URI"`. The server also migrates on start, but doing it first shows any error before the new version serves traffic.
5. Merge the tag change. The service rebuilds from `infra/mlflow`; check its log ends with `Uvicorn running`, and that the app's log shows no `tracing_export_failed` and the next `trace_retention` line.

If the upgrade fails, redeploy the previous image and restore the dumps with `pg_restore --clean -d mlflow mlflow.dump`.

## Local MLflow

Port 5000 is taken by AirPlay on macOS, so use 5001. Turn MLflow's own usage telemetry off, and run one worker: with the default, workers kept restarting on this Mac.

```
docker run -d --name mlflow-local -e MLFLOW_DISABLE_TELEMETRY=true -e DO_NOT_TRACK=true \
  -e MLFLOW_SERVER_ENABLE_JOB_EXECUTION=false \
  -p 127.0.0.1:5001:5000 -v mlflow-local:/mlflow ghcr.io/mlflow/mlflow:v3.16.1-full \
  mlflow server --host 0.0.0.0 --port 5000 --workers 1 --backend-store-uri sqlite:////mlflow/mlflow.db \
  --artifacts-destination /mlflow/artifacts --serve-artifacts \
  --allowed-hosts localhost:5001,127.0.0.1:5001
curl -s -X POST localhost:5001/api/2.0/mlflow/experiments/create \
  -H 'Content-Type: application/json' -d '{"name":"lift-dev"}'
```

Then set `TRACING=metadata`, `MLFLOW_TRACKING_URI=http://127.0.0.1:5001`, `MLFLOW_EXPERIMENT_ID=<id>` and a `TRACE_USER_SECRET`, and open http://localhost:5001 to see the traces.

To try the production image with basic auth on Postgres, build `infra/mlflow` and run it with the variables from [tracing-setup.md](tracing-setup.md), plus `MLFLOW_HOST=0.0.0.0` so Docker's IPv4 port mapping reaches it.

## Checked against MLflow 3.16.1 (3 October 2026)

- OTLP JSON is accepted; no protobuf exporter is needed.
- With `--app-name basic-auth`, `/v1/traces`, trace search, trace deletion and the UI all answer 401 without credentials.
- Basic auth keeps its users in the database named in its config file only; `infra/mlflow/start.sh` writes that file from `MLFLOW_AUTH_DB_URI`. On Postgres the users survived a restart. The admin user is created on the first start from `MLFLOW_AUTH_ADMIN_PASSWORD`.
- With `default_permission = NO_PERMISSIONS` a new user can do nothing. EDIT on the experiment allows sending and searching traces; deleting them needs MANAGE. Permissions are granted with `POST /api/3.0/mlflow/users/permissions/grant`. The app's user couldn't read another experiment, but can list user names.
- `--host ::` listens on IPv6 only (asyncio sets `IPV6_V6ONLY`). Railway's private network has IPv6 in every environment; in a dual-stack one, Node tries the IPv6 address after the IPv4 one is refused.
- One server held up to 9 Postgres connections under a burst of requests, with pools of 2 plus 2 overflow; two servers at once exhausted a role limit of 10, and requests hung for two minutes before failing. Hence the limit of 25 in [tracing-setup.md](tracing-setup.md).
- By default the server starts eight background job processes (online scoring, archival); with `MLFLOW_SERVER_ENABLE_JOB_EXECUTION=false` it used about 0.4 GB instead of 1.6 GB.
- MLflow sends usage telemetry to its makers unless `MLFLOW_DISABLE_TELEMETRY=true` (or `DO_NOT_TRACK=true`) is set; the image sets both.
- `user.id` and `session.id` on the root become the trace's user and session; `gen_ai.operation.name` gives the span types (AGENT, CHAT_MODEL, TOOL) and `gen_ai.usage.*` the trace's token totals, including Jev's.
- MLflow adds its own cost estimate from the model names (for `openai/gpt-5.6-luna` too). It is not OpenRouter's bill: use `lift.cost_usd` on chat spans and `lift.cost_usd_total` on the root.
- No request or response preview is stored. A canary sent in a Coach message, a photo label, tool arguments, a made-up tool name, the reply, the athlete's name, a call transcript, a connection report's reason and video feedback, and the photo's category and tags, appeared nowhere in MLflow's database, SQLite or Postgres.
- One trace of each kind (`image_tag`, `voice_setup`, `voice_tool`, `voice_socket`, `voice_tidy`, `video_job`) arrived with its tree, user and session; the four voice traces of one call shared a session.
- Search is `POST /api/3.0/mlflow/traces/search` with the filter ``metadata.`mlflow.trace.user` = '<code>'``; deletion is `POST /api/2.0/mlflow/traces/delete-traces`, by ids or by `max_timestamp_millis` with `max_traces`. Deleting a trace removes its spans. Deleting a test account's traces, and the retention sweep, worked with the app user's credentials.
- With MLflow stopped, a turn takes as long as with tracing off.
- `next build --webpack` bundles the packages without warnings or `serverExternalPackages`; the exporter loads on demand from its own chunk. The built bundle exports, and flushes on SIGTERM. A script that ends on its own flushes before it exits.

Not checked, because it needs Railway: the image on Railway itself, the Tailscale router and its host name, and the private network in this project's environment.
