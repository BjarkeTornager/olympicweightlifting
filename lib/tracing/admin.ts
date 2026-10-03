// Deleting traces through MLflow's REST API: an account's traces when the
// account is deleted, and every trace past the retention period (janitor.ts).
// Both run whenever MLflow is configured, with capture on or off.
// Checked against MLflow 3.16.1.
import { errorCategory } from "../error-log";
import { traceAdminConfig, type MlflowTarget } from "./config";

const PAGE = 500;
const BATCH = 1000;

async function call(
  config: MlflowTarget,
  path: string,
  body: unknown,
  transport: typeof fetch,
) {
  const response = await transport(`${config.trackingUri}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.authorization ? { Authorization: config.authorization } : {}),
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`MLflow returned ${response.status}.`);
  }
  return (await response.json()) as Record<string, unknown>;
}

// Deletes every trace carrying this account code (ids.ts). Returns how many
// were deleted; 0 with no MLflow configured.
export async function deleteUserTraces(
  code: string,
  config: MlflowTarget | null = traceAdminConfig(),
  transport: typeof fetch = fetch,
) {
  if (!config) return 0;
  if (!/^[0-9a-f]{32}$/.test(code)) throw Error("Invalid trace code.");
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page++) {
    const found = await call(
      config,
      "/api/3.0/mlflow/traces/search",
      {
        locations: [
          {
            type: "MLFLOW_EXPERIMENT",
            mlflow_experiment: { experiment_id: config.experimentId },
          },
        ],
        filter: `metadata.\`mlflow.trace.user\` = '${code}'`,
        max_results: PAGE,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
      transport,
    );
    const traces = Array.isArray(found.traces) ? found.traces : [];
    for (const trace of traces) {
      const id = (trace as { trace_id?: unknown }).trace_id;
      if (typeof id === "string") ids.push(id);
    }
    pageToken =
      typeof found.next_page_token === "string" && found.next_page_token
        ? found.next_page_token
        : undefined;
    if (!pageToken) break;
  }
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const result = await call(
      config,
      "/api/2.0/mlflow/traces/delete-traces",
      {
        experiment_id: config.experimentId,
        request_ids: ids.slice(i, i + 100),
      },
      transport,
    );
    deleted += Number(result.traces_deleted) || 0;
  }
  return deleted;
}

// A deleted account's traces, removed once its deletion has been answered
// (app/api/account). Best effort: a failure is logged by category, and the
// retention janitor removes what is left within TRACE_RETENTION_DAYS.
export async function deleteAccountTraces(
  code: string,
  config: MlflowTarget | null = traceAdminConfig(),
  transport: typeof fetch = fetch,
) {
  try {
    const deleted = await deleteUserTraces(code, config, transport);
    console.info(JSON.stringify({ event: "account_traces_deleted", deleted }));
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "account_traces_delete_failed",
        category: errorCategory(error),
      }),
    );
  }
}

// Deletes every trace older than `days`, oldest first, in batches until a
// batch comes back short. Safe to run from two instances at once.
export async function deleteOlderThan(
  days: number,
  config: MlflowTarget | null = traceAdminConfig(),
  transport: typeof fetch = fetch,
  now = Date.now(),
) {
  if (!config) return 0;
  const before = now - days * 86400000;
  let deleted = 0;
  for (let batch = 0; batch < 1000; batch++) {
    const result = await call(
      config,
      "/api/2.0/mlflow/traces/delete-traces",
      {
        experiment_id: config.experimentId,
        max_timestamp_millis: before,
        max_traces: BATCH,
      },
      transport,
    );
    const count = Number(result.traces_deleted) || 0;
    deleted += count;
    if (count < BATCH) break;
  }
  return deleted;
}
