// Deletes traces past TRACE_RETENTION_DAYS every six hours. MLflow's own
// archival never deletes, so this is what keeps the privacy page's 30 days.
// Started from instrumentation.ts on every server; it runs whenever MLflow is
// configured, including with TRACING off, so turning capture off still lets
// the traces already sent expire.
import { deleteOlderThan, deletionFailure } from "./admin";
import { traceAdminConfig } from "./config";

const KEY = Symbol.for("lift.tracing.janitor");
const shared = globalThis as unknown as Record<symbol, boolean | undefined>;

export async function sweepTraces() {
  const config = traceAdminConfig();
  if (!config) return;
  try {
    const deleted = await deleteOlderThan(config.retentionDays, config);
    console.info(
      JSON.stringify({
        event: "trace_retention",
        deleted,
        days: config.retentionDays,
      }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "trace_retention_failed",
        ...deletionFailure(error),
      }),
    );
  }
}

// True when the janitor was started, now or before.
export function startTraceJanitor() {
  if (shared[KEY]) return true;
  if (!traceAdminConfig()) return false;
  shared[KEY] = true;
  setTimeout(() => void sweepTraces(), 60000).unref();
  setInterval(() => void sweepTraces(), 6 * 3600000).unref();
  return true;
}
