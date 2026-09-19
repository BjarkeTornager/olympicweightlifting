import { z } from "zod";
import type { JournalState } from "./model";

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone");
export const reminderPreferencesSchema = z
  .object({
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: timeZoneSchema,
    topics: z
      .array(z.enum(["food", "sleep", "workout"]))
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export type ReminderPreferences = z.infer<typeof reminderPreferencesSchema>;
export const defaultReminderPreferences: ReminderPreferences = {
  time: "20:00",
  timezone: "Europe/Copenhagen",
  topics: ["food", "sleep", "workout"],
};

export function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (key: string) => parts.find((p) => p.type === key)!.value;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function reminderDue(
  preferences: ReminderPreferences,
  lastDate: string | null,
  now: Date,
) {
  const local = localClock(now, preferences.timezone);
  const [hour, minute] = preferences.time.split(":").map(Number);
  const elapsed = local.minutes - (hour * 60 + minute);
  // A server restart must not produce a late-night backlog. Local dates also
  // prevent repeated delivery during a daylight-saving clock rollback.
  return lastDate !== local.date && elapsed >= 0 && elapsed < 90
    ? local.date
    : null;
}

export function missingReminderTopics(
  state: JournalState,
  date: string,
  topics: ReminderPreferences["topics"],
) {
  return topics.filter((topic) => {
    if (topic === "food")
      return (
        !state.nutrition.completeDays?.includes(date) &&
        !state.nutrition.meals.some((m) => m.date === date)
      );
    if (topic === "sleep")
      return !state.health.checkins.some(
        (c) => c.date === date && c.sleepHours !== null,
      );
    // Absence of training may be a rest day. Only nudge an unfinished session.
    return state.activeWorkout?.date === date;
  });
}

// Endpoints are user input. Never let a subscription turn the worker into an
// arbitrary URL fetcher; only the supported browser push services are accepted.
export function supportedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.hostname === "web.push.apple.com" ||
        url.hostname.endsWith(".push.apple.com") ||
        url.hostname === "fcm.googleapis.com" ||
        url.hostname === "updates.push.services.mozilla.com" ||
        url.hostname === "wns2-db5p.notify.windows.com" ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine(supportedPushEndpoint, "Unsupported push service"),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
      })
      .strict(),
  })
  .strict();
