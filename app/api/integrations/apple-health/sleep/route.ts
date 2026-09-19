import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { healthConnections } from "@/lib/db/schema";
import { authorizeHealthImport, importSleep } from "@/lib/apple-health-store";
import { readJson } from "@/lib/agent/http";
import { trackingResponse, trackingFailure } from "@/lib/tracking-http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let connection: Awaited<ReturnType<typeof authorizeHealthImport>> | undefined;
  try {
    connection = await authorizeHealthImport(request);
    return trackingResponse(
      await importSleep(
        connection.userId,
        connection.hash,
        await readJson(request, 180000),
      ),
    );
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
