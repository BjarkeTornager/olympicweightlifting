// Railway sets RAILWAY_GIT_COMMIT_SHA for deployments built from GitHub;
// a manual upload has none, so the commit is reported as unknown.
export async function GET() {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  return Response.json({ status: "ok", version: "2.0.0", commit });
}
