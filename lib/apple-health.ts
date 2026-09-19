import { z } from "zod";
import { foodDate } from "./nutrition";
import { localClock, timeZoneSchema } from "./reminders";
import { offsetDate } from "./health";

export const sleepImportSchema = z
  .object({
    date: foodDate,
    timezone: timeZoneSchema,
    samples: z
      .array(
        z
          .object({
            start: z.iso.datetime({ offset: true }),
            end: z.iso.datetime({ offset: true }),
            // Normalise the localized Health labels in the Shortcut, not on the server.
            value: z.enum(["asleep", "core", "deep", "rem", "awake", "inBed"]),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

export function calculateImportedSleep(raw: unknown, now = new Date()) {
  const input = sleepImportSchema.parse(raw);
  const current = localClock(now, input.timezone).date;
  if (input.date > current || input.date < offsetDate(current, -14))
    throw Error("Import a waking date within the last 14 days.");
  const previous = offsetDate(input.date, -1);
  const intervals: [number, number][] = [];
  for (const sample of input.samples) {
    const start = new Date(sample.start),
      end = new Date(sample.end);
    const a = localClock(start, input.timezone),
      b = localClock(end, input.timezone);
    const inWindow = (p: typeof a) =>
      (p.date === previous && p.minutes >= 720) ||
      (p.date === input.date && p.minutes <= 720);
    if (
      start >= end ||
      end > now ||
      end.getTime() - start.getTime() > 25 * 3600000 ||
      !inWindow(a) ||
      !inWindow(b)
    )
      throw Error(
        "Use sleep samples from noon before the waking date through noon on the waking date.",
      );
    if (sample.value !== "awake" && sample.value !== "inBed")
      intervals.push([start.getTime(), end.getTime()]);
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const prior = merged.at(-1);
    if (prior && interval[0] <= prior[1])
      prior[1] = Math.max(prior[1], interval[1]);
    else merged.push([...interval]);
  }
  if (!merged.length)
    throw Error(
      "No time asleep was found. Awake and in-bed samples do not count as sleep.",
    );
  const minutes = Math.round(
    merged.reduce((sum, [a, b]) => sum + b - a, 0) / 60000,
  );
  if (minutes < 1 || minutes > 1440)
    throw Error("Sleep duration must be between one minute and 24 hours.");
  return {
    date: input.date,
    timezone: input.timezone,
    hours: minutes / 60,
    start: new Date(merged[0][0]).toISOString(),
    end: new Date(merged.at(-1)![1]).toISOString(),
    intervals: merged,
  };
}
