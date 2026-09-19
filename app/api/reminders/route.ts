import { z } from "zod";
import { getPool } from "@/lib/db";
import { ApiError, readJson, requireAthlete } from "@/lib/agent/http";
import { allowRequest } from "@/lib/server";
import {
  defaultReminderPreferences,
  reminderPreferencesSchema,
  pushSubscriptionSchema,
} from "@/lib/reminders";
import { reminderConfiguration } from "@/lib/reminder-worker";
import { trackingResponse, trackingFailure } from "@/lib/tracking-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAthlete(request);
    const { rows } = await getPool().query(
      "SELECT enabled,preferences,last_date::text AS last_date,last_status FROM daily_reminders WHERE user_id=$1",
      [user.id],
    );
    const config = reminderConfiguration();
    return trackingResponse({
      configured: Boolean(config),
      publicKey: config?.publicKey ?? null,
      enabled: rows[0]?.enabled ?? false,
      preferences: rows[0]?.preferences ?? defaultReminderPreferences,
      lastDate: rows[0]?.last_date ?? null,
      lastStatus: rows[0]?.last_status ?? null,
    });
  } catch (error) {
    return trackingFailure(error);
  }
}
export async function PUT(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    if (!(await allowRequest(user.id, "reminder-settings", 20)))
      throw new ApiError("Please wait a minute and try again.", 429);
    const input = z
      .object({
        preferences: reminderPreferencesSchema,
        subscription: pushSubscriptionSchema,
      })
      .strict()
      .parse(await readJson(request, 6000));
    if (!reminderConfiguration())
      throw new ApiError(
        "Reminders are not configured on this server yet.",
        503,
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(81521345)");
      const owner = await client.query(
        "SELECT user_id FROM daily_reminders WHERE endpoint=$1",
        [input.subscription.endpoint],
      );
      if (owner.rows[0] && owner.rows[0].user_id !== user.id)
        throw new ApiError(
          "This browser has reminders for another account. Turn them off there first.",
          409,
        );
      await client.query(
        `INSERT INTO daily_reminders (user_id,enabled,preferences,subscription,endpoint) VALUES ($1,true,$2,$3,$4)
        ON CONFLICT (user_id) DO UPDATE SET enabled=true,preferences=$2,subscription=$3,endpoint=$4,updated_at=now()`,
        [
          user.id,
          JSON.stringify(input.preferences),
          JSON.stringify(input.subscription),
          input.subscription.endpoint,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return trackingResponse({ enabled: true });
  } catch (error) {
    return trackingFailure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    const user = await requireAthlete(request, true);
    await getPool().query(
      "UPDATE daily_reminders SET enabled=false,subscription=NULL,endpoint=NULL,updated_at=now() WHERE user_id=$1",
      [user.id],
    );
    return trackingResponse({ enabled: false });
  } catch (error) {
    return trackingFailure(error);
  }
}
