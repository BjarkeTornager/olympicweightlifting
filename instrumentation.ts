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
}
