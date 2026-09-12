export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.VIDEO_ANALYSIS_WORKER === "1"
  ) {
    const { startVideoWorker } = await import("./lib/video/worker");
    startVideoWorker();
  }
}
