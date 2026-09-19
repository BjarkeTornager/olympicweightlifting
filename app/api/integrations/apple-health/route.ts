import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { healthConnections } from "@/lib/db/schema";
import { ApiError, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
import { createHealthConnection } from "@/lib/apple-health-store";
import { trackingResponse, trackingFailure } from "@/lib/tracking-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    const [connection] = await getDb()
      .select({
        createdAt: healthConnections.createdAt,
        lastSyncAt: healthConnections.lastSyncAt,
        lastDate: healthConnections.lastDate,
        lastResult: healthConnections.lastResult,
      })
      .from(healthConnections)
      .where(eq(healthConnections.userId, user.id));
    return trackingResponse({ connected: Boolean(connection), ...connection });
  } catch (error) {
    return trackingFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "health-connection", 5)))
      throw new ApiError(
        "Please wait a minute before creating another key.",
        429,
      );
    return trackingResponse({ token: await createHealthConnection(user.id) });
  } catch (error) {
    return trackingFailure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    await getDb()
      .delete(healthConnections)
      .where(eq(healthConnections.userId, user.id));
    return trackingResponse({ connected: false });
  } catch (error) {
    return trackingFailure(error);
  }
}
