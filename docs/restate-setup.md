# Restate setup (no user traffic yet)

This is PR 4 of the Restate plan: a Restate server next to the app, and an endpoint inside the app that Restate calls. Nothing user-facing uses it yet. The endpoint serves one `Ping` service, so the path can be checked end to end, deployed and restarted before Coach turns move onto it (PR 6).

Everything is **off** unless `RESTATE_ENDPOINT=1`. Off, `instrumentation.ts` never imports `lib/restate`, so the SDK is never loaded and port 9080 stays closed. A test enforces that only `lib/restate/endpoint.ts` and `lib/restate/ping.ts` import the SDK.

## How it works

- `lib/restate/endpoint.ts` starts a separate HTTP/2 server on port 9080 (`RESTATE_ENDPOINT_PORT`) with the SDK's `createEndpointHandler`. It is not a Next.js route: over HTTP/1.1 the SDK runs in request-response mode, where Restate suspends and replays the handler at every step.
- It listens on `::` in production, which takes IPv6 and IPv4 on Railway's private network, and on `127.0.0.1` locally (`RESTATE_ENDPOINT_HOST` overrides both).
- Calls must be signed. Restate signs each request with an Ed25519 private key; the endpoint accepts only keys listed in `RESTATE_IDENTITY_KEYS` and answers anything else with 401. `/health` is the only path without a signature. In production the endpoint refuses to start without keys.
- `Ping.ping` records one step that returns the time and `RAILWAY_DEPLOYMENT_ID`, so a call shows which container ran it. Journal and idempotency retention are one hour. It holds no account data.
- On SIGTERM it stops taking connections and sends GOAWAY on the open ones, so Restate opens a new connection, which reaches the new container, while calls in progress finish. Next.js then exits as it does today.
- If the endpoint can't start (a bad setting, the port taken, or the SDK failing to load), one `restate_endpoint_disabled` or `restate_endpoint_failed` line is logged and the app carries on serving. On start it logs `restate_endpoint_started` with the port and whether calls are signed.
- `scripts/restate-register.ts` registers the endpoint with Restate's admin API (see Runbook). It is bundled into the image as `/app/restate-register.cjs` so it can run in the container, which is on the private network.
- `scripts/restate-identity-key.ts` makes a signing key pair.

## Environment

On **lift-journal** (all kept by `.railway/railway.ts` with `preserve()`):

| Variable                                         | Value                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESTATE_ENDPOINT`                               | `1` starts the endpoint; anything else, or unset, leaves it off                                                                                                                                                                                                                                                         |
| `RESTATE_IDENTITY_KEYS`                          | The public key from `scripts/restate-identity-key.ts`, `publickeyv1_...`. Comma-separated while rotating                                                                                                                                                                                                                |
| `RESTATE_ADMIN_URL`                              | `http://restate.railway.internal:9070`, for the register script                                                                                                                                                                                                                                                         |
| `RESTATE_INGRESS_URL`                            | `http://restate.railway.internal:8080`, for `--ping` now and Coach turns later                                                                                                                                                                                                                                          |
| `RESTATE_ENDPOINT_PORT`, `RESTATE_ENDPOINT_HOST` | Leave unset (9080 and `::`)                                                                                                                                                                                                                                                                                             |
| `RESTATE_LOGGING`                                | Optional SDK log level: `TRACE`, `DEBUG`, `INFO` (default), `WARN` or `ERROR`. Any other value stops the SDK from loading, which leaves the endpoint off. At `INFO` the SDK logs the start and end of every call with its target; once Coach runs there, that target includes the account id, so set `WARN` before PR 6 |

## Railway steps (for the owner)

The `restate` service is not in `.railway/railway.ts`: that file is a partial that manages only `lift-journal`, so `railway config apply` leaves the new service alone, as it does PostgreSQL.

1. **Make a signing key**, on the Mac, from the repository:

   ```sh
   node --import tsx scripts/restate-identity-key.ts
   ```

   It prints `RESTATE_IDENTITY_PRIVATE_KEY_B64=...` for the restate service and `RESTATE_IDENTITY_KEYS=publickeyv1_...` for lift-journal. Paste each into Railway's variables as you go and keep no other copy.

2. **Create the service.** In the `olympicweightlifting` project, production environment: New, Docker Image, `docker.restate.dev/restatedev/restate:1.7.13`. Name it `restate` (its private address is then `restate.railway.internal`). Settings:
   - Region: `europe-west4-drams3a`, the same as lift-journal. One replica (Railway allows no more with a volume).
   - **No public domain.** Don't generate one, and don't add a TCP proxy.
   - Custom start command, exactly:

     ```
     /bin/sh -c "umask 077 && printenv RESTATE_IDENTITY_PRIVATE_KEY_B64 | base64 -d > /tmp/restate-identity.pem && exec restate-server"
     ```

     Railway runs a start command in exec form without expanding variables, so the shell writes the key to a file only the container sees (not the volume) and then becomes Restate itself, which receives SIGTERM.

   - Health check path `/health`, timeout 60 s. Railway checks the port in `PORT`, set to 9070 below; this is the admin API's health, and it is checked only during a deploy.
   - Restart policy: on failure. Leave Serverless (app sleeping) off: a sleeping Restate fires no timers and runs no retries.
   - Resource limit: 2 GB memory. The main budgets below add up to about 1.1 GiB; Restate used about 100 MiB in the local check.

3. **Attach a volume** at `/restate-data`, the image's data directory. No volume backups (decision 8): Postgres is the source of truth. Restate's data lives in `/restate-data/<node name>/`, so the node name below must never change, or Restate starts empty.

4. **Variables on restate:**

   | Variable                                                         | Value                       | Why                                                                                                                              |
   | ---------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
   | `RESTATE_NODE_NAME`                                              | `restate-1`                 | Fixed; the default is the container's hostname, which changes on every deploy                                                    |
   | `RESTATE_CLUSTER_NAME`                                           | `lift-journal`              | Fixed                                                                                                                            |
   | `RESTATE_BIND_IP`                                                | `::`                        | Ingress, admin API and node port on IPv6 and IPv4                                                                                |
   | `PORT`                                                           | `9070`                      | Only tells Railway's health check where to look; Restate ignores it                                                              |
   | `RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE`                              | `512MiB`                    | Down from 2 GiB                                                                                                                  |
   | `RESTATE_ADMIN__QUERY_ENGINE__MEMORY_SIZE`                       | `256MiB`                    | Down from 1 GiB                                                                                                                  |
   | `RESTATE_BIFROST__RECORD_CACHE_MEMORY_SIZE`                      | `128MiB`                    | Down from 250 MiB                                                                                                                |
   | `RESTATE_WORKER__INVOKER__CONCURRENT_INVOCATIONS_LIMIT`          | `100`                       | Down from 1000                                                                                                                   |
   | `RESTATE_WORKER__INVOKER__MEMORY_LIMIT`                          | `256MiB`                    | Down from 1.5 GiB                                                                                                                |
   | `RESTATE_DEFAULT_NUM_PARTITIONS`                                 | `4`                         | Down from 24. Read only when the cluster is first created                                                                        |
   | `RESTATE_DEFAULT_JOURNAL_RETENTION`                              | `1h`                        | Down from 1 day, as the plan's privacy section says                                                                              |
   | `RESTATE_DEFAULT_IDEMPOTENCY_RETENTION`                          | `1h`                        | Likewise                                                                                                                         |
   | `RESTATE_DISABLE_TELEMETRY`                                      | `true`                      | No usage reports to Restate's makers                                                                                             |
   | `RESTATE_IDENTITY_PRIVATE_KEY_B64`                               | From step 1                 | Sealed                                                                                                                           |
   | `RESTATE_WORKER__INVOKER__REQUEST_IDENTITY_PRIVATE_KEY_PEM_FILE` | `/tmp/restate-identity.pem` | Where the start command writes the key                                                                                           |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`                            | `60`                        | Railway's default is 0, which kills Restate straight after SIGTERM; it needs up to its 1-minute shutdown timeout to stop cleanly |

   Don't set `RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7` or `RESTATE_EXPERIMENTAL_ENABLE_VQUEUES`: the SDK notes they can only be turned on for a new cluster, so they can't be turned off again.

5. **Deploy restate.** In its logs, `Loaded request identity key` must show the same `kid: "publickeyv1_..."` as `RESTATE_IDENTITY_KEYS`, and the health check must pass.

6. **Set lift-journal's variables** from the table above: `RESTATE_IDENTITY_KEYS`, `RESTATE_ADMIN_URL`, `RESTATE_INGRESS_URL`, and last `RESTATE_ENDPOINT=1`. Deploy lift-journal (merging this PR does). Its log must show `{"event":"restate_endpoint_started","port":9080,"signed":true}`.

7. **Register the endpoint** from the Mac:

   ```sh
   railway ssh --service lift-journal -- env \
     RESTATE_ADMIN_URL=http://restate.railway.internal:9070 \
     RESTATE_INGRESS_URL=http://restate.railway.internal:8080 \
     RESTATE_DEPLOYMENT_URL=http://lift-journal.railway.internal:9080 \
     node /app/restate-register.cjs --dry-run
   ```

   It should say `Would register http://lift-journal.railway.internal:9080: Ping (Service): ping`. Run it again without `--dry-run` and with `--ping`. Expect `Registered ... as dp_...` and a pong whose `deployment` is lift-journal's current deployment id. (The URLs are given in full because an SSH session may not carry the service's variables.)

8. **Check a restart.** Restart the restate service in Railway. The app keeps serving throughout (nothing depends on Restate yet); afterwards step 7 with `--ping` says `nothing changed` and pongs again.

9. **Check a deploy.** Redeploy lift-journal. Afterwards `--ping` answers with the new deployment id, with no new registration needed.

**Rollback:** set `RESTATE_ENDPOINT=0` on lift-journal and redeploy; then, if wanted, delete the restate service and its volume. Restate holds nothing the app needs.

## Runbook

- **After a deploy that adds, removes or changes a service or handler**, run the register command from step 7, first with `--dry-run`. It never uses `force`. Restate answers a second registration of the same address with the old services and ignores the change, so the script compares the endpoint's services (discovered through Restate, which signs the request) with the registered ones and, when they differ, updates that deployment in place. It refuses, and changes nothing, while any invocation of those services hasn't completed (running, suspended, backing off, paused or scheduled), and it refuses outright to change a service's type: give it a new name instead. Never rename a service or handler in place.
- **When it refuses**, look at what is waiting and cancel it if it is stuck: `railway ssh --service restate`, then `restate invocations list`, `restate invocations describe <id>` and `restate invocations cancel <id>` (`--kill` when cancelling hangs). The `restate` CLI in the image talks to the local admin API.
- **Is it working?** Step 7 with `--ping`. `restate deployments list` and `restate services list` over SSH to the restate service show what is registered.
- **Restate restarts or redeploys** are a short outage of Restate only: with a volume, Railway stops the old container before starting the new one. Calls in progress are retried once it is back.
- **Upgrades:** patch releases (1.7.x) at any time by changing the image tag. Minor versions one at a time, never during an app deploy, after reading the release notes; for 1.8, upgrade `@restatedev/restate-sdk` with the server.
- **Rotating the signing key:** make a new pair; set `RESTATE_IDENTITY_KEYS` to the new and old public keys, comma-separated, and deploy lift-journal; replace `RESTATE_IDENTITY_PRIVATE_KEY_B64` on restate and redeploy it; then remove the old public key.
- **Memory:** watch the restate service's memory in Railway for the first week. The settings above are ceilings that Restate stays under; raise them only if it is close to them.

## Local development

```sh
docker compose --env-file .env.local --profile restate up -d restate
RESTATE_ENDPOINT=1 npm run dev
node --import tsx scripts/restate-register.ts --ping
```

The Compose service is the same image with the same memory settings, unsigned, with ingress on `localhost:8080` and the admin API and UI on <http://localhost:9070>. It reaches the app at `http://host.docker.internal:9080`, the script's local default. Without `--profile restate`, `docker compose up` starts only PostgreSQL, as before. `docker compose --env-file .env.local --profile restate rm -sf restate` stops it; the `lift-restate` volume keeps its data.

To try signing locally, run the image with the start command and variables from step 2 and 4 and set `RESTATE_IDENTITY_KEYS` for the app.

## Checked against Restate 1.7.13 and SDK 1.17.2 (3 October 2026)

These answer the parts of the plan's "Check before relying on it" that this PR depends on.

- **The SDK's WASM loads from `instrumentation.ts` under `next build --webpack` and the standalone server: yes.** The SDK inlines its 1.6 MB WASM as base64. Next.js bundles the instrumentation layer (`instrument` is in `WEBPACK_LAYERS.GROUP.bundled` in `next/dist/lib/constants.js`), so the SDK lands in one 2.3 MB server chunk that `.next/server/instrumentation.js` loads only inside the `RESTATE_ENDPOINT === "1"` check. The build gave no warnings; the standalone `server.js` started the endpoint and answered Ping through Restate, and so did `next dev` (Turbopack). `serverExternalPackages` isn't needed: Next's docs (`serverExternalPackages.md`) describe it as an opt-out for dependencies that use Node.js-specific features and need native `require`, and the bundled SDK works as it is.
- **HTTP/2 over IPv6 between services: works locally; still to check on Railway.** On an IPv6-only Docker network, with the services named `restate.railway.internal` and `lift-journal.railway.internal`, the app built from the standalone output listened on `::`, Restate reached it over IPv6 with HTTP/2 and signed requests, and `restate-register.cjs` ran inside the app container. With a second app container under the same name, as in Railway's 30-second overlap, Restate kept using its open HTTP/2 connection to the old container; when the old one got SIGTERM, it exited with 143 after GOAWAY and the next Ping reached the new container in 40 ms, with no error. Railway's private DNS during the overlap may behave differently: check it in the rehearsal.
- **Restate's memory with the reduced settings:** about 82 MiB idle and 92 to 100 MiB after 300 Pings, against about 200 MiB idle with the defaults (on an arm64 Mac under Colima). Coach journals will be larger than Ping's; measure on Railway.
- **Signing:** a key from `scripts/restate-identity-key.ts`, given to Restate through the step 2 start command, made Restate log the same `publickeyv1_` key; the endpoint accepted Restate's calls and answered 401 to unsigned discovery and to a Restate with another key. The key file is mode 600 and `restate-server` runs as process 1.
- **Registration:** the admin API's `force` defaults to `true` (its OpenAPI at `:9070/openapi`), so the script sends `false`. With `force: false` a second registration of the same address returns the old services with status 200 and silently ignores new handlers; an update in place (`PATCH /deployments/{id}` with `overwrite`) applies them, and with `dry_run` it only shows them. The script refused while a removed handler's invocation was backing off.
- **Compatibility:** the SDK README's table lists SDK 1.15 to 1.16 for Restate 1.7, and the 1.17 release notes add no server requirement. The endpoint registered with 1.7.13 declaring service protocol versions 5 to 7, and Ping ran. Protocol 7 stays off on the server.
- **A restart of Restate:** the app answered all 100 health checks during `docker compose restart restate` (Restate itself was down for about half a second), and with Restate stopped the app and the endpoint kept serving. After the restart the registration was still there and Ping answered.
- **Server defaults to override later:** a service registered without options gets Restate's default retry policy, 70 attempts and then **pause**. The plan's `onMaxAttempts: "kill"` for CoachSession has to be set in its options in PR 6.
- **Not checked here:** an idempotency key on a request-response call made from a handler (PR 9). The SDK has `idempotencyKey` in `ClientCallOptions` (`types/rpc.d.ts`); at the ingress, two calls with the same `idempotency-key` header returned the same result.
