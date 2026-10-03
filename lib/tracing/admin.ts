// Deleting traces through MLflow's REST API: an account's traces when the
// account is deleted, and every trace past the retention period (janitor.ts).
// Both run whenever MLflow is configured, with capture on or off.
// Checked against MLflow 3.16.1.
import { errorCategory } from "../error-log";
import { traceAdminConfig, type MlflowTarget } from "./config";

const PAGE = 500;
const BATCH = 1000;

// MLflow's answer when it refuses, such as 403 when the app's MLflow user
// lacks MANAGE on the experiment (docs/tracing-setup.md).
export class MlflowError extends Error {
  constructor(readonly status: number) {
    super(`MLflow returned ${status}.`);
  }
}

// What a failed deletion logs: the category and MLflow's status, if any.
export const deletionFailure = (error: unknown) => ({
  category: errorCategory(error),
  ...(error instanceof MlflowError ? { status: error.status } : {}),
});

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
    throw new MlflowError(response.status);
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

// Sends the spans this server has ended but not yet exported, so that a
// search finds their traces. The provider is read from where provider.ts
// shares it, so OpenTelemetry is never loaded here.
async function flushEnded() {
  const state = (
    globalThis as unknown as Record<
      symbol,
      { provider: { forceFlush(): Promise<void> } } | undefined
    >
  )[Symbol.for("lift.tracing")];
  await state?.provider.forceFlush().catch(() => {});
}

// Work for the account still running when it is deleted, such as a video
// review or a Coach turn, ends its trace after the first search. A video
// review notices within ten seconds and runs ten minutes at most, and a
// Coach turn has 90 seconds, so a second pass this much later finds those
// traces.
const SECOND_PASS_MS = 15 * 60000;

async function deletionPass(
  code: string,
  config: MlflowTarget | null,
  transport: typeof fetch,
  later: boolean,
) {
  const pass = later ? { later } : {};
  try {
    await flushEnded();
    const deleted = await deleteUserTraces(code, config, transport);
    console.info(
      JSON.stringify({ event: "account_traces_deleted", deleted, ...pass }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "account_traces_delete_failed",
        ...deletionFailure(error),
        ...pass,
      }),
    );
  }
}

// A deleted account's traces, removed once its deletion has been answered
// (app/api/account) and again SECOND_PASS_MS later. Best effort: a failure
// is logged by category, and the retention janitor removes what is left
// within TRACE_RETENTION_DAYS, as it does when a restart drops the second
// pass.
export async function deleteAccountTraces(
  code: string,
  config: MlflowTarget | null = traceAdminConfig(),
  transport: typeof fetch = fetch,
) {
  await deletionPass(code, config, transport, false);
  if (config)
    setTimeout(
      () => void deletionPass(code, config, transport, true),
      SECOND_PASS_MS,
    ).unref();
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
