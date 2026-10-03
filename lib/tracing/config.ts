// Diagnostic tracing to a self-hosted MLflow (docs/tracing.md). Capture is
// off unless TRACING=metadata, which is also the kill switch: with it off,
// nothing in lib/tracing loads OpenTelemetry, creates a provider or sends a
// trace. Deleting traces already sent (traceAdminConfig) carries on.
//
// Traces hold metadata only: timings, models, token counts, cost, tool names,
// counts and error categories. Never messages, replies, journal entries,
// photos or tool inputs. Accounts are linked only by an HMAC code (ids.ts).

// Where traces live: MLflow's base URL, without a trailing slash, the
// experiment and, when the server has auth on, Basic auth for the lift-app
// MLflow user.
export type MlflowTarget = {
  trackingUri: string;
  experimentId: string;
  authorization?: string;
};

export type TracingConfig = MlflowTarget & {
  userSecret: string;
  // The share of Coach turns traced, from 0 to 1, decided at each root.
  sampleRate: number;
  retentionDays: number;
  // Message text on model calls, for synthetic accounts on a local server
  // only (contentAllowed). Never in production.
  content: boolean;
};

// Deleting traces: past retention (janitor.ts) and with their account
// (admin.ts). The secret is only there when TRACE_USER_SECRET is set.
export type TraceAdminConfig = MlflowTarget & {
  userSecret?: string;
  retentionDays: number;
};

type Env = Record<string, string | undefined>;

const reported = new Set<string>();

// One line per reason and process, so a missing variable is noticed in the
// logs without repeating on every turn.
export function disabled(reason: string): null {
  if (!reported.has(reason)) {
    reported.add(reason);
    console.warn(JSON.stringify({ event: "tracing_disabled", reason }));
  }
  return null;
}

function databaseName(url: string | undefined) {
  try {
    return url ? new URL(url).pathname.slice(1) : "";
  } catch {
    return "";
  }
}

// TRACE_CONTENT=1 counts only away from production, on a disposable *_test
// database and with MLflow on this machine.
export function contentAllowed(env: Env, trackingUri: string) {
  if (env.TRACE_CONTENT !== "1" || env.NODE_ENV === "production") return false;
  if (!databaseName(env.DATABASE_URL).endsWith("_test")) return false;
  return ["localhost", "127.0.0.1"].includes(new URL(trackingUri).hostname);
}

// MLflow's address, experiment and auth, or why they are unusable.
function mlflowTarget(env: Env): MlflowTarget | string {
  const uri = env.MLFLOW_TRACKING_URI?.trim().replace(/\/+$/, "");
  if (!uri) return "missing_tracking_uri";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "invalid_tracking_uri";
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return "invalid_tracking_uri";
  const experimentId = env.MLFLOW_EXPERIMENT_ID?.trim();
  if (!experimentId || !/^[0-9]{1,20}$/.test(experimentId))
    return "missing_experiment_id";
  const username = env.MLFLOW_TRACKING_USERNAME,
    password = env.MLFLOW_TRACKING_PASSWORD;
  return {
    trackingUri: uri,
    experimentId,
    ...(username && password
      ? {
          authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        }
      : {}),
  };
}

// The privacy page promises deletion within 30 days, so no longer.
function retentionDays(env: Env) {
  const days = Number(env.TRACE_RETENTION_DAYS?.trim() || 30);
  return Number.isInteger(days) && days >= 1 && days <= 30 ? days : null;
}

export function tracingConfig(env: Env = process.env): TracingConfig | null {
  const mode = env.TRACING?.trim() || "off";
  if (mode === "off") return null;
  if (mode !== "metadata") return disabled("unknown_mode");
  const target = mlflowTarget(env);
  if (typeof target === "string") return disabled(target);
  const userSecret = env.TRACE_USER_SECRET ?? "";
  if (!userSecret) return disabled("missing_user_secret");
  // Production codes must not be guessable from a short secret.
  if (env.NODE_ENV === "production" && userSecret.length < 32)
    return disabled("weak_user_secret");
  const sampleRate = Number(env.TRACE_SAMPLE_RATE?.trim() || 1);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    return disabled("invalid_sample_rate");
  const days = retentionDays(env);
  if (!days) return disabled("invalid_retention_days");
  return {
    ...target,
    userSecret,
    sampleRate,
    retentionDays: days,
    content: contentAllowed(env, target.trackingUri),
  };
}

// Needs only MLflow, not TRACING: turning capture off, or a capture setting
// going invalid, must still let traces already sent expire and be deleted
// with their account. An invalid retention falls back to the 30 days.
export function traceAdminConfig(
  env: Env = process.env,
): TraceAdminConfig | null {
  const target = mlflowTarget(env);
  if (typeof target === "string") return null;
  return {
    ...target,
    ...(env.TRACE_USER_SECRET ? { userSecret: env.TRACE_USER_SECRET } : {}),
    retentionDays: retentionDays(env) ?? 30,
  };
}
