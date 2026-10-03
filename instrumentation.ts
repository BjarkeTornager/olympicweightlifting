export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.DAILY_REMINDERS_WORKER === "1"
  ) {
    const { startReminderWorker } = await import("./lib/reminder-worker");
    startReminderWorker();
  }
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.VIDEO_ANALYSIS_WORKER === "1"
  ) {
    const { startVideoWorker } = await import("./lib/video/worker");
    startVideoWorker();
  }
  // Deletes diagnostic traces past their retention (lib/tracing). It
  // decides itself whether to run: whenever MLflow is configured, whatever
  // TRACING says.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTraceJanitor } = await import("./lib/tracing/janitor");
    startTraceJanitor();
  }
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.SWEEPER_WORKER === "1"
  ) {
    const { startSweeper } = await import("./lib/sweeper");
    startSweeper();
  }
  // Restate's endpoint on its own port (docs/restate-setup.md). Off by
  // default, and then the SDK is never loaded. If it can't load (such as an
  // unknown RESTATE_LOGGING level, which the SDK throws on), the app still
  // starts.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.RESTATE_ENDPOINT === "1"
  ) {
    try {
      const { startRestateEndpoint } = await import("./lib/restate/endpoint");
      startRestateEndpoint();
    } catch (error) {
      const { logFailure } = await import("./lib/error-log");
      logFailure("restate_endpoint_failed", error);
    }
  }
}
