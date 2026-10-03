// Diagnostic tracing to a self-hosted MLflow (docs/tracing.md). Off unless
// TRACING=metadata, which is also the kill switch: with it off, nothing in
// lib/tracing loads OpenTelemetry, creates a provider or sends anything.
//
// Traces hold metadata only: timings, models, token counts, cost, tool names,
// counts and error categories. Never messages, replies, journal entries,
// photos or tool inputs. Accounts are linked only by an HMAC code (ids.ts).

export type TracingConfig = {
  // MLflow's base URL, without a trailing slash.
  trackingUri: string;
  experimentId: string;
  // Basic auth for the lift-app MLflow user, when the server has auth on.
  authorization?: string;
  userSecret: string;
  // The share of Coach turns traced, from 0 to 1, decided at each root.
  sampleRate: number;
  retentionDays: number;
  // Message text on model calls, for synthetic accounts on a local server
  // only (contentAllowed). Never in production.
  content: boolean;
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

export function tracingConfig(env: Env = process.env): TracingConfig | null {
  const mode = env.TRACING?.trim() || "off";
  if (mode === "off") return null;
  if (mode !== "metadata") return disabled("unknown_mode");
  const uri = env.MLFLOW_TRACKING_URI?.trim().replace(/\/+$/, "");
  if (!uri) return disabled("missing_tracking_uri");
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return disabled("invalid_tracking_uri");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return disabled("invalid_tracking_uri");
  const experimentId = env.MLFLOW_EXPERIMENT_ID?.trim();
  if (!experimentId || !/^[0-9]{1,20}$/.test(experimentId))
    return disabled("missing_experiment_id");
  const userSecret = env.TRACE_USER_SECRET ?? "";
  if (!userSecret) return disabled("missing_user_secret");
  // Production codes must not be guessable from a short secret.
  if (env.NODE_ENV === "production" && userSecret.length < 32)
    return disabled("weak_user_secret");
  const sampleRate = Number(env.TRACE_SAMPLE_RATE?.trim() || 1);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    return disabled("invalid_sample_rate");
  // The privacy page promises deletion within 30 days, so no longer.
  const retentionDays = Number(env.TRACE_RETENTION_DAYS?.trim() || 30);
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 30
  )
    return disabled("invalid_retention_days");
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
    userSecret,
    sampleRate,
    retentionDays,
    content: contentAllowed(env, uri),
  };
}
