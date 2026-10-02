import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { healthConnections } from "@/lib/db/schema";
import { authorizeHealthImport, importSleep } from "@/lib/apple-health-store";
import { readJson } from "@/lib/agent/http";
import { trackingResponse, trackingFailure } from "@/lib/tracking-http";
import { countUse } from "@/lib/feature-use";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let connection: Awaited<ReturnType<typeof authorizeHealthImport>> | undefined;
  try {
    connection = await authorizeHealthImport(request);
    const result = await importSleep(
      connection.userId,
      connection.hash,
      await readJson(request, 180000),
    );
    void countUse(connection.userId, "health.sync.shortcut");
    return trackingResponse(result);
  } catch (error) {
    if (connection)
      await getDb()
        .update(healthConnections)
        .set({ lastResult: "failed" })
        .where(
          and(
            eq(healthConnections.userId, connection.userId),
            eq(healthConnections.tokenHash, connection.hash),
          ),
        )
        .catch(() => {});
    return trackingFailure(error);
  }
}
