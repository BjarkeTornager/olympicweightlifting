import webpush from "web-push";
import { getPool } from "./db";
import { userAllowed } from "./access";
import { journalSchema } from "./model";
import {
  missingReminderTopics,
  reminderDue,
  reminderPreferencesSchema,
  pushSubscriptionSchema,
} from "./reminders";

export function reminderConfiguration() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT || process.env.BETTER_AUTH_URL;
  return publicKey &&
    privateKey &&
    subject &&
    process.env.DAILY_REMINDERS_WORKER === "1"
    ? { publicKey, privateKey, subject }
    : null;
}

// Claims persist before sending. This favours at most one daily attempt over
// duplicate notifications after a process crash or ambiguous push response.
export async function deliverReminders(
  now = new Date(),
  send = webpush.sendNotification,
) {
  const config = reminderConfiguration();
  if (!config) return;
  const pool = getPool();
  const candidates = await pool.query(
    "SELECT user_id FROM daily_reminders WHERE enabled=true ORDER BY updated_at LIMIT 1000",
  );
  for (const { user_id: userId } of candidates.rows) {
    const client = await pool.connect();
    let delivery:
      { subscription: webpush.PushSubscription; date: string } | undefined;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT r.*, r.last_date::text AS last_date_text, u.email, u.email_verified, j.state FROM daily_reminders r
        JOIN users u ON u.id=r.user_id LEFT JOIN journals j ON j.user_id=r.user_id
        WHERE r.user_id=$1 AND r.enabled=true FOR UPDATE OF r SKIP LOCKED`,
        [userId],
      );
      const row = rows[0];
      if (row) {
        const preferences = reminderPreferencesSchema.parse(row.preferences);
        const date = reminderDue(preferences, row.last_date_text, now);
        if (date) {
          const allowed = await userAllowed({
            id: userId,
            email: row.email,
            emailVerified: row.email_verified,
          });
          const state = row.state && journalSchema.parse(row.state);
          const missing =
            state && missingReminderTopics(state, date, preferences.topics);
          const shouldSend =
            allowed && Boolean(missing?.length) && Boolean(row.subscription);
          await client.query(
            "UPDATE daily_reminders SET last_date=$2,last_status=$3 WHERE user_id=$1",
            [userId, date, shouldSend ? "sending" : "skipped"],
          );
          if (shouldSend)
            delivery = {
              date,
              subscription: pushSubscriptionSchema.parse(row.subscription),
            };
        }
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      console.error(JSON.stringify({ event: "reminder_check_failed" }));
    } finally {
      client.release();
    }
    if (!delivery) continue;
    // Recheck opt-out immediately before the external send.
    const active = await pool.query(
      "SELECT 1 FROM daily_reminders WHERE user_id=$1 AND enabled=true AND endpoint=$2",
      [userId, delivery.subscription.endpoint],
    );
    if (!active.rowCount) continue;
    try {
      await send(
        delivery.subscription,
        JSON.stringify({
          title: "A moment for your journal",
          body: "Anything you’d like to add today? A photo or a sentence is enough.",
        }),
        {
          vapidDetails: config,
          TTL: 3600,
          timeout: 10000,
          topic: "daily-catch-up",
          urgency: "normal",
        },
      );
      await pool.query(
        "UPDATE daily_reminders SET last_status='sent' WHERE user_id=$1 AND last_date=$2 AND endpoint=$3",
        [userId, delivery.date, delivery.subscription.endpoint],
      );
    } catch (error) {
      const expired = [404, 410].includes(
        (error as { statusCode?: number }).statusCode ?? 0,
      );
      await pool.query(
        `UPDATE daily_reminders SET last_status=$2, enabled=CASE WHEN $3 THEN false ELSE enabled END,
        subscription=CASE WHEN $3 THEN NULL ELSE subscription END, endpoint=CASE WHEN $3 THEN NULL ELSE endpoint END
        WHERE user_id=$1 AND endpoint=$4`,
        [
          userId,
          expired ? "expired" : "failed",
          expired,
          delivery.subscription.endpoint,
        ],
      );
    }
  }
}

const processState = globalThis as typeof globalThis & {
  reminderTimer?: ReturnType<typeof setTimeout>;
};
export function startReminderWorker() {
  if (processState.reminderTimer || !reminderConfiguration()) return;
  const tick = async () => {
    try {
      await deliverReminders();
    } catch {
      console.error(JSON.stringify({ event: "reminder_worker_failed" }));
    }
    processState.reminderTimer = setTimeout(tick, 60000);
    processState.reminderTimer.unref();
  };
  processState.reminderTimer = setTimeout(tick, 5000);
  processState.reminderTimer.unref();
}
