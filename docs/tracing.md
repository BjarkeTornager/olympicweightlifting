# Diagnostic tracing (MLflow)

Coach turns can be traced to a self-hosted MLflow, to find slow or failing replies. A trace holds metadata only: timings, models, token counts, cost, routing, skills, tool names, change kinds, counts, status and error categories. It never holds messages, Coach's replies, the system prompt, journal entries, tool inputs or results, photos or what a photo shows. Accounts appear only as an HMAC code.

Tracing is **off** unless `TRACING=metadata`. Off is also the kill switch for capture: nothing in `lib/tracing` loads OpenTelemetry, no provider is created and no trace is sent. Deletion is separate and keeps running while `MLFLOW_TRACKING_URI` and `MLFLOW_EXPERIMENT_ID` are set, whatever `TRACING` says, so the traces already sent still expire and are deleted with their account. To cut MLflow off entirely, unset those two as well, but only once the older traces are gone.

Production stays off until the privacy page has its Diagnostics paragraph and the MLflow service exists (see the plan's PR 3 and infra steps).

## How it works

- `lib/tracing` is the only code that may import `@opentelemetry/*` (a test enforces it), and only `provider.ts` does at run time. It is loaded on the first traced turn.
- The tracer provider is never registered globally, so Next.js keeps its own spans off and Coach's spans don't nest under them. Spans go over OTLP/HTTP JSON to `${MLFLOW_TRACKING_URI}/v1/traces`.
- Every attribute key has a validator in `attributes.ts`: a number, a boolean, a value from a fixed list or a short slug. Anything else is dropped and counted in `lift.dropped_attrs`. A tool span is `tool.<name>` only for a tool Coach has, otherwise `tool.unknown`.
- Errors are recorded only as their `errorCategory` (`lib/error-log.ts`).
- Each Coach turn is one trace: `coach_turn` with `prepare` (and `photos_sorted`), `route` (Jev's tokens), one `round` per model round, one `chat` per provider call (including a call the content filter blocked), one span per tool, and `commit`. The trace id is saved in the turn's metrics as `traceId`.
- Traces past `TRACE_RETENTION_DAYS` are deleted every six hours by the janitor that `instrumentation.ts` starts. `deleteUserTraces` in `admin.ts` deletes an account's traces by its code (wired to account deletion in a later PR). Both use `traceAdminConfig`, which needs only the MLflow variables: with `TRACING=off`, or a capture variable that is invalid, they still run. An invalid `TRACE_RETENTION_DAYS` falls back to 30 for deletion.
- On SIGTERM Next.js exits as soon as the last open request closes, before the batch timer would send the spans that request's turn ended with. So during that drain a turn waits up to half a second for its trace to be sent before it returns (`settle` in `spans.ts`).

## Environment

| Variable | Meaning |
|---|---|
| `TRACING` | `off` (default) or `metadata` |
| `MLFLOW_TRACKING_URI` | MLflow's base URL, such as `http://127.0.0.1:5001` |
| `MLFLOW_EXPERIMENT_ID` | The experiment traces go to. The janitor and account deletion look only in this one, so before changing it, delete the old experiment's traces |
| `MLFLOW_TRACKING_USERNAME`, `MLFLOW_TRACKING_PASSWORD` | Basic auth, when the server has it on |
| `TRACE_USER_SECRET` | HMAC secret for account and session codes; at least 32 characters in production. Don't rotate it: older traces could then only expire, not be deleted with their account |
| `TRACE_SAMPLE_RATE` | Share of turns traced, 0 to 1 (default 1) |
| `TRACE_RETENTION_DAYS` | 1 to 30 (default 30) |
| `TRACE_CONTENT` | `1` adds message text, with images as `[image]`, only when `NODE_ENV` isn't production, the database name ends in `_test` and MLflow is on localhost. For synthetic eval and bench accounts |

A missing or invalid variable turns capture off with one `tracing_disabled` log line naming the reason. Failed exports log `tracing_export_failed` at most every ten minutes and slow a turn only during a drain, by half a second at most.

## Local MLflow

Port 5000 is taken by AirPlay on macOS, so use 5001. Turn MLflow's own usage telemetry off, and run one worker: with the default, workers kept restarting on this Mac.

```
docker run -d --name mlflow-local -e MLFLOW_DISABLE_TELEMETRY=true -e DO_NOT_TRACK=true \
  -p 127.0.0.1:5001:5000 -v mlflow-local:/mlflow ghcr.io/mlflow/mlflow:v3.16.1-full \
  mlflow server --host 0.0.0.0 --port 5000 --workers 1 --backend-store-uri sqlite:////mlflow/mlflow.db \
  --artifacts-destination /mlflow/artifacts --serve-artifacts \
  --allowed-hosts localhost:5001,127.0.0.1:5001
curl -s -X POST localhost:5001/api/2.0/mlflow/experiments/create \
  -H 'Content-Type: application/json' -d '{"name":"lift-dev"}'
```

Then set `TRACING=metadata`, `MLFLOW_TRACKING_URI=http://127.0.0.1:5001`, `MLFLOW_EXPERIMENT_ID=<id>` and a `TRACE_USER_SECRET`, and open http://localhost:5001 to see the traces.

## Checked against MLflow 3.16.1 (3 October 2026)

- OTLP JSON is accepted; no protobuf exporter is needed.
- With `--app-name basic-auth`, `/v1/traces`, trace search and trace deletion all answer 401 without credentials.
- MLflow sends usage telemetry to its makers unless `MLFLOW_DISABLE_TELEMETRY=true` (or `DO_NOT_TRACK=true`) is set: set it on the Railway service too.
- `user.id` and `session.id` on the root become the trace's user and session; `gen_ai.operation.name` gives the span types (AGENT, CHAT_MODEL, TOOL) and `gen_ai.usage.*` the trace's token totals, including Jev's.
- MLflow adds its own cost estimate from the model names (for `openai/gpt-5.6-luna` too). It is not OpenRouter's bill: use `lift.cost_usd` on chat spans and `lift.cost_usd_total` on the root.
- No request or response preview is stored, and a canary sent in a message, a photo label, tool arguments, a made-up tool name and the reply appeared nowhere in MLflow's database.
- Search is `POST /api/3.0/mlflow/traces/search` with the filter ``metadata.`mlflow.trace.user` = '<code>'``; deletion is `POST /api/2.0/mlflow/traces/delete-traces`, by ids or by `max_timestamp_millis` with `max_traces`. Deleting a trace removes its spans.
- With MLflow stopped, a turn takes as long as with tracing off.
- `next build --webpack` bundles the packages without warnings or `serverExternalPackages`; the exporter loads on demand from its own chunk. The built bundle exports, and flushes on SIGTERM. A script that ends on its own flushes before it exits.
