// Deletes traces past TRACE_RETENTION_DAYS every six hours. MLflow's own
// archival never deletes, so this is what keeps the privacy page's 30 days.
// Started from instrumentation.ts when tracing is on.
import { errorCategory } from "../error-log";
import { deleteOlderThan } from "./admin";
import { tracingConfig } from "./config";

const KEY = Symbol.for("lift.tracing.janitor");
const shared = globalThis as unknown as Record<symbol, boolean | undefined>;

export async function sweepTraces() {
  const config = tracingConfig();
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
        category: errorCategory(error),
      }),
    );
  }
}

export function startTraceJanitor() {
  if (shared[KEY] || !tracingConfig()) return;
  shared[KEY] = true;
  setTimeout(() => void sweepTraces(), 60000).unref();
  setInterval(() => void sweepTraces(), 6 * 3600000).unref();
}
