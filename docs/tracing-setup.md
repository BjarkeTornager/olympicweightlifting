# Setting up diagnostic tracing in production

The owner's steps to run MLflow for Lift Journal's diagnostic traces on Railway and switch tracing on. What traces hold, and how they are deleted, is in [tracing.md](tracing.md).

What this sets up, in the `olympicweightlifting` project's production environment:

- an `mlflow` service, built from `infra/mlflow` (MLflow 3.16.1 with basic auth), reachable only on Railway's private network;
- an `mlflow` Postgres role with two databases, `mlflow` and `mlflow_auth`, in the existing Postgres;
- a Tailscale subnet router, so the owner can open the MLflow UI from a Mac;
- the variables that point `lift-journal` at MLflow.

Expected cost: about $5 to $10 a month for MLflow (it used about 0.4 GB of memory locally), about $1 for the Tailscale router, and cents for Postgres rows.

**Order matters.** Tracing stays off (`TRACING` unset) until the end. The privacy page describing traces must be live in production before `TRACING=metadata` is set (step 6). Everything before that changes nothing the athletes see.

## 0. Before you start

You need the Railway CLI, signed in and linked to the project (`railway login`, then `railway link` in the repo and choose `olympicweightlifting` and `production`), a Tailscale account, and `openssl`.

Make five secrets and keep them in your password manager. Hex keeps them free of characters that URLs or MLflow's config file would need escaped.

```
openssl rand -hex 24   # MLFLOW_DB_PASSWORD: the mlflow Postgres role
openssl rand -hex 24   # MLFLOW_AUTH_ADMIN_PASSWORD: MLflow's admin user, for you
openssl rand -hex 32   # MLFLOW_FLASK_SERVER_SECRET_KEY
openssl rand -hex 24   # LIFT_APP_PASSWORD: MLflow's lift-app user, for the app
openssl rand -hex 32   # TRACE_USER_SECRET: never rotate it
```

`TRACE_USER_SECRET` turns account ids into the codes traces carry. If it ever changes, older traces can no longer be found for an account, so they could only expire, not be deleted with it.

## 1. Postgres: a role and two databases

Open `psql` on the project's Postgres as its superuser:

```
railway connect Postgres
```

(Use the Postgres service's name if it isn't `Postgres`.) Then, with your `MLFLOW_DB_PASSWORD`:

```sql
CREATE ROLE mlflow LOGIN PASSWORD '<MLFLOW_DB_PASSWORD>' CONNECTION LIMIT 25;
CREATE DATABASE mlflow OWNER mlflow;
CREATE DATABASE mlflow_auth OWNER mlflow;
REVOKE CONNECT ON DATABASE mlflow, mlflow_auth FROM PUBLIC;
```

The limit keeps MLflow from taking connections the app needs. Locally one MLflow server used up to 9 under a burst of requests, and two run side by side for a moment during a redeploy; with a limit of 10 the second one's requests failed.

Now keep the `mlflow` role out of the app's database. Find the app's database with `\l` (usually `railway`) and its two roles: the user names in `DATABASE_URL` and `MIGRATION_DATABASE_URL` on the `lift-journal` service (Railway, lift-journal, Variables). Grant those two first, then revoke from everyone else:

```sql
GRANT CONNECT ON DATABASE railway TO <app role>, <migration role>;
REVOKE CONNECT ON DATABASE railway FROM PUBLIC;
SELECT has_database_privilege('<app role>', 'railway', 'CONNECT'),
       has_database_privilege('<migration role>', 'railway', 'CONNECT'),
       has_database_privilege('mlflow', 'railway', 'CONNECT');
```

The check must show `t | t | f`. If either app role shows `f`, undo at once with `GRANT CONNECT ON DATABASE railway TO PUBLIC;` and look again at the role names: open connections keep working, but the app's next new connection would be refused. (If a URL uses the `postgres` superuser, that role needs no grant.)

Checked locally on PostgreSQL 16: after these steps the app's role can't open `mlflow`, and `mlflow` can't open the app's database.

## 2. The `mlflow` service

In the Railway dashboard, project `olympicweightlifting`, environment `production`:

1. **New, GitHub Repo**, `BjarkeTornager/olympicweightlifting`. Name the service exactly `mlflow`: the name gives its private address, `mlflow.railway.internal`.
2. **Settings**:
   - Source: Root Directory `/infra/mlflow` (Railway builds the `Dockerfile` there), branch `main`, Watch Paths `/infra/mlflow/**`, so app changes don't redeploy MLflow.
   - Region: the same as `lift-journal`, `europe-west4` (Netherlands). The privacy page says traces are stored in the Netherlands.
   - Networking: don't generate a public domain. Private networking stays on.
   - Resource limits: 1 GB memory, 1 vCPU. Replicas: 1.
   - Deploy: no custom start command (the image's `start.sh` starts MLflow) and no healthcheck path.
3. **Volume**: add one, mounted at `/data`, 1 GB. Only MLflow's artifact folder uses it; traces live in Postgres.
4. **Variables** (with `Postgres` replaced by the Postgres service's name, if different):

   ```
   MLFLOW_BACKEND_STORE_URI=postgresql://mlflow:<MLFLOW_DB_PASSWORD>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/mlflow
   MLFLOW_AUTH_DB_URI=postgresql://mlflow:<MLFLOW_DB_PASSWORD>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/mlflow_auth
   MLFLOW_AUTH_ADMIN_PASSWORD=<MLFLOW_AUTH_ADMIN_PASSWORD>
   MLFLOW_FLASK_SERVER_SECRET_KEY=<MLFLOW_FLASK_SERVER_SECRET_KEY>
   MLFLOW_SQLALCHEMYSTORE_POOL_SIZE=2
   MLFLOW_SQLALCHEMYSTORE_MAX_OVERFLOW=2
   MLFLOW_ALLOWED_HOSTS=mlflow.railway.internal:5000
   ```

   The image itself turns off MLflow's usage telemetry and its background jobs. `infra/mlflow/start.sh` writes basic auth's config from these variables, so its users live in `mlflow_auth` and survive redeploys, and gives no one any access until it is granted.
5. **Deploy.** The first start creates the tables and the admin user; it can take a minute or two. The log should show `Created admin user 'admin'.` (first start only) and end with `Uvicorn running on http://[::]:5000`.

`MLFLOW_AUTH_ADMIN_PASSWORD` is only read while no admin exists. To change the admin password later, use MLflow's update-password API; changing the variable does nothing.

## 3. Tailscale, to open the UI

1. In the [Tailscale admin console](https://login.tailscale.com/admin), make sure MagicDNS is on (DNS).
2. Access controls: add a tag and let it approve Railway's routes:

   ```jsonc
   "tagOwners": { "tag:railway": ["autogroup:admin"] },
   "autoApprovers": {
     "routes": {
       "fd00::/8":   ["tag:railway"],
       "10.0.0.0/8": ["tag:railway"]
     }
   }
   ```

3. Settings, Keys, Generate auth key: reusable, ephemeral, pre-approved, with the tag `tag:railway`.
4. In Railway, deploy the [Tailscale Subnet Router](https://railway.com/deploy/tailscale-subnet-router) template into the same project and environment. Set `TS_AUTHKEY` to the key, and add a volume at `/var/lib/tailscale` so it keeps its identity across redeploys.
5. Its log prints the routes it advertises and a split-DNS line. In Tailscale, DNS, Nameservers, Add nameserver, Custom: enter the router's tailnet IP and restrict it to the domain the log names, of the form `olympicweightlifting-production-railway.internal`.
6. Add that host to the `mlflow` service, so MLflow accepts it, and let it redeploy:

   ```
   MLFLOW_ALLOWED_HOSTS=mlflow.railway.internal:5000,mlflow.olympicweightlifting-production-railway.internal:5000
   ```

   (with the domain exactly as the router's log gave it).
7. With Tailscale on, open `http://mlflow.olympicweightlifting-production-railway.internal:5000` and sign in as `admin`. Basic auth stays on behind Tailscale as a second lock.

## 4. The experiment and the app's MLflow user

From the Mac, with Tailscale on. Reading the passwords with `read -rs` keeps them out of the shell history:

```
M=http://mlflow.olympicweightlifting-production-railway.internal:5000
read -rs ADMIN_PW    # paste MLFLOW_AUTH_ADMIN_PASSWORD, then Return
read -rs APP_PW      # paste LIFT_APP_PASSWORD, then Return

curl -s -u "admin:$ADMIN_PW" -X POST $M/api/2.0/mlflow/experiments/create \
  -H 'Content-Type: application/json' -d '{"name":"lift-journal-production"}'
# {"experiment_id": "<id>"}: note the id
curl -s -u "admin:$ADMIN_PW" -X POST $M/api/2.0/mlflow/users/create \
  -H 'Content-Type: application/json' -d "{\"username\":\"lift-app\",\"password\":\"$APP_PW\"}"
curl -s -u "admin:$ADMIN_PW" -X POST $M/api/3.0/mlflow/users/permissions/grant \
  -H 'Content-Type: application/json' \
  -d '{"username":"lift-app","resource_type":"experiment","resource_id":"<id>","permission":"MANAGE"}'
curl -s -u "admin:$ADMIN_PW" \
  "$M/api/3.0/mlflow/users/permissions/get?username=lift-app&resource_type=experiment&resource_id=<id>"
# {"allowed":true,"permission":"MANAGE"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST $M/v1/traces
# 401: nothing gets in without a password
```

`lift-app` needs MANAGE, not EDIT: EDIT can send and search traces, but MLflow refuses every deletion, so traces would never expire or go with their account. `lift-app` can't read any other experiment.

## 5. Point the app at MLflow, with capture still off

On the `lift-journal` service, add these together (one redeploy). Leave `TRACING` unset.

```
MLFLOW_TRACKING_URI=http://mlflow.railway.internal:5000
MLFLOW_EXPERIMENT_ID=<id>
MLFLOW_TRACKING_USERNAME=lift-app
MLFLOW_TRACKING_PASSWORD=<LIFT_APP_PASSWORD>
TRACE_USER_SECRET=<TRACE_USER_SECRET>
TRACE_RETENTION_DAYS=30
TRACE_SAMPLE_RATE=1
NEXT_OTEL_FETCH_DISABLED=1
```

Never set `TRACE_CONTENT` on Railway. `.railway/railway.ts` already preserves all of these, so applying the Railway config won't delete them.

About a minute after the redeploy, the app's log shows the retention sweep, which deletion and expiry both depend on:

```
{"event":"trace_retention","deleted":0,"days":30}
```

If it shows `trace_retention_failed` instead: `"status":401` is a wrong `MLFLOW_TRACKING_PASSWORD`, `"status":403` means `lift-app` lacks MANAGE (step 4), and a `network_...` category means the URI or the private network. Fix it before going on.

## 6. Privacy text live, then switch tracing on

1. Open the production privacy page (`/privacy`) and check that How we measure use has the paragraph on diagnostic traces, and Your training assistant the one on Exa. Both shipped with the code that deletes traces with an account.
2. Set `TRACING=metadata` on `lift-journal`.
3. After the redeploy, send Coach a message. In MLflow, `lift-journal-production`, Traces: a `coach_turn` trace with a user and a session, its steps, token counts and no request or response preview.
4. The app's log must have no `tracing_disabled` line (it names what is missing) and no `tracing_export_failed`.

Then update the App Store privacy label in App Store Connect, App Privacy: add Diagnostics, Performance Data, linked to the user (the pseudonymous code links it to the account), not used for tracking, for App Functionality.

## 7. The first day, and after

- Coach's speed before and after: `npm run coach:metrics -- --split <the time TRACING was set>`, comparing p50 and p95 of total and first-text time.
- The day's `coach_turn` traces should match its Coach turns in `agent_turns`.
- MLflow's memory in Railway's metrics (about 0.4 GB expected), and the `mlflow` role's Postgres connections (up to 9 locally, limit 25).
- Each week: `trace_retention` lines every six hours.
- MLflow's [security advisories](https://github.com/mlflow/mlflow/security/advisories); upgrading is in [tracing.md](tracing.md#upgrading-mlflow).
- Later, the website and an iPhone build can send `callId` with every voice request, not only with cards, so a whole call groups in one session. Ship that only after this server version is deployed.

## Turning it off

- **Capture only:** `TRACING=off` (or unset). Traces already sent still expire and are still deleted with their account, because the MLflow variables stay.
- **Removing MLflow:** first turn capture off and wait 30 days, so the last traces have expired. Then remove the `MLFLOW_*` and `TRACE_*` variables from `lift-journal`, delete the `mlflow` and Tailscale router services, and in `psql`:

  ```sql
  DROP DATABASE mlflow;
  DROP DATABASE mlflow_auth;
  DROP ROLE mlflow;
  ```

  Then change the privacy page to say traces are no longer recorded.
