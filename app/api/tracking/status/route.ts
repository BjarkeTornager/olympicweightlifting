import { requireAthlete } from "@/lib/agent/http";
import { getPool } from "@/lib/db";
import { providerBudget } from "@/lib/provider-budget";
import { reminderConfiguration } from "@/lib/reminder-worker";
import { trackingNotices } from "@/lib/tracking-status";
import { trackingResponse, trackingFailure } from "@/lib/tracking-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    const [health, reminder, budget] = await Promise.all([
      getPool().query(
        "SELECT last_result,last_sync_at,last_date::text AS last_date FROM health_connections WHERE user_id=$1",
        [user.id],
      ),
      getPool().query(
        "SELECT enabled,last_status FROM daily_reminders WHERE user_id=$1",
        [user.id],
      ),
      providerBudget(),
    ]);
    return trackingResponse({
      notices: trackingNotices({
        health: health.rows[0],
        reminder: reminder.rows[0],
        budget,
        remindersConfigured: Boolean(reminderConfiguration()),
      }),
      sleep: health.rows[0]
        ? {
            connected: true,
            lastSyncAt: health.rows[0].last_sync_at,
            lastDate: health.rows[0].last_date,
          }
        : { connected: false },
    });
  } catch (error) {
    return trackingFailure(error);
  }
}
