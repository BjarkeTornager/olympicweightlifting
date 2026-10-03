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
  // Deletes diagnostic traces past their retention (lib/tracing).
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.TRACING === "metadata"
  ) {
    const { startTraceJanitor } = await import("./lib/tracing/janitor");
    startTraceJanitor();
  }
}
