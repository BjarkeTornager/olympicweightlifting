import { z } from "zod";
import { foodDate } from "./nutrition";
import type { JournalState } from "./model";

export const cardioActivities = [
  "running",
  "cycling",
  "walking",
  "swimming",
  "rowing",
  "hiking",
  "elliptical",
  "other",
] as const;
export const cardioActivitySchema = z.enum(cardioActivities);
export type CardioActivity = z.infer<typeof cardioActivitySchema>;
export const cardioLabels: Record<CardioActivity, string> = {
  running: "Running",
  cycling: "Cycling",
  walking: "Walking",
  swimming: "Swimming",
  rowing: "Rowing",
  hiking: "Hiking",
  elliptical: "Elliptical",
  other: "Other activity",
};
const fields = {
  activity: cardioActivitySchema,
  date: foodDate,
  durationSeconds: z.number().int().min(1).max(604800),
  distanceKm: z.number().finite().min(0).max(10000).nullable(),
  title: z.string().trim().max(120),
  durationType: z.enum(["unspecified", "moving", "elapsed"]),
  averageHeartRate: z.number().int().min(30).max(300).nullable(),
  maxHeartRate: z.number().int().min(30).max(300).nullable(),
  effort: z.number().finite().min(1).max(10).nullable(),
  elevationGainM: z.number().finite().min(0).max(30000).nullable(),
  caloriesKcal: z.number().finite().min(0).max(50000).nullable(),
  notes: z.string().trim().max(2000),
};
const heartRatesValid = (v: {
  averageHeartRate?: number | null;
  maxHeartRate?: number | null;
}) =>
  v.averageHeartRate == null ||
  v.maxHeartRate == null ||
  v.maxHeartRate >= v.averageHeartRate;
export const cardioInputSchema = z
  .object({
    ...fields,
    distanceKm: fields.distanceKm.default(null),
    title: fields.title.default(""),
    durationType: fields.durationType.default("unspecified"),
    averageHeartRate: fields.averageHeartRate.default(null),
    maxHeartRate: fields.maxHeartRate.default(null),
    effort: fields.effort.default(null),
    elevationGainM: fields.elevationGainM.default(null),
    caloriesKcal: fields.caloriesKcal.default(null),
    notes: fields.notes.default(""),
  })
  .strict()
  .refine(
    heartRatesValid,
    "Maximum heart rate cannot be lower than average heart rate",
  );
export const cardioPatchSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Include an activity correction");
export const cardioEntrySchema = cardioInputSchema.safeExtend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const cardioSchema = z
  .object({ sessions: z.array(cardioEntrySchema).max(5000).default([]) })
  .superRefine((v, ctx) => {
    if (new Set(v.sessions.map((s) => s.id)).size !== v.sessions.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate cardio activity IDs",
      });
  });
export type CardioEntry = z.infer<typeof cardioEntrySchema>;
export type CardioInput = z.infer<typeof cardioInputSchema>;
export type CardioPatch = z.infer<typeof cardioPatchSchema>;
export function saveCardio(
  state: JournalState,
  raw: unknown,
  currentDate: string,
  id?: string,
): CardioEntry {
  const existing = id
    ? state.cardio.sessions.find((s) => s.id === id)
    : undefined;
  if (id && !existing) throw Error("That activity is not in your journal.");
  const previous = existing
    ? Object.fromEntries(
        Object.entries(existing).filter(
          ([key]) => !["id", "createdAt", "updatedAt"].includes(key),
        ),
      )
    : {};
  const input = cardioInputSchema.parse(
    existing ? { ...previous, ...cardioPatchSchema.parse(raw) } : raw,
  );
  if (input.date > currentDate)
    throw Error("Completed activities cannot be dated in the future.");
  const now = new Date().toISOString();
  const entry = cardioEntrySchema.parse({
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  state.cardio.sessions = [
    ...state.cardio.sessions.filter((s) => s.id !== entry.id),
    entry,
  ];
  return entry;
}
export const cardioTitle = (entry: Pick<CardioEntry, "title" | "activity">) =>
  entry.title || cardioLabels[entry.activity];
export function formatDuration(seconds: number) {
  const total = Math.round(seconds),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    remainder = total % 60;
  return (
    [
      hours ? `${hours} h` : "",
      minutes ? `${minutes} min` : "",
      remainder ? `${remainder} sec` : "",
    ]
      .filter(Boolean)
      .join(" ") || "0 min"
  );
}
export function cardioRate(
  entry: Pick<CardioEntry, "activity" | "distanceKm" | "durationSeconds">,
) {
  if (!entry.distanceKm) return null;
  if (
    entry.activity === "cycling" ||
    entry.activity === "elliptical" ||
    entry.activity === "other"
  )
    return `${Math.round((entry.distanceKm / entry.durationSeconds) * 36000) / 10} km/h`;
  const scale =
    entry.activity === "swimming" ? 0.1 : entry.activity === "rowing" ? 0.5 : 1;
  const seconds = Math.round(
    (entry.durationSeconds / entry.distanceKm) * scale,
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /${scale === 0.1 ? "100 m" : scale === 0.5 ? "500 m" : "km"}`;
}
export function cardioSummary(
  state: JournalState,
  from: string,
  to: string,
  activity?: CardioActivity,
) {
  const sessions = state.cardio.sessions
    .filter(
      (s) =>
        s.date >= from &&
        s.date <= to &&
        (!activity || s.activity === activity),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  const total = (entries: CardioEntry[]) => ({
    sessions: entries.length,
    durationSeconds: entries.reduce((n, s) => n + s.durationSeconds, 0),
    distanceKm: entries.some((s) => s.distanceKm != null)
      ? Math.round(
          entries.reduce((n, s) => n + (s.distanceKm ?? 0), 0) * 1000,
        ) / 1000
      : null,
    distanceSamples: entries.filter((s) => s.distanceKm != null).length,
  });
  return {
    from,
    to,
    ...total(sessions),
    byActivity: cardioActivities
      .map((activity) => ({
        activity,
        label: cardioLabels[activity],
        ...total(sessions.filter((s) => s.activity === activity)),
      }))
      .filter((s) => s.sessions),
    daily: [...new Set(sessions.map((s) => s.date))]
      .sort()
      .map((date) => ({
        date,
        ...total(sessions.filter((s) => s.date === date)),
      })),
    entries: sessions,
    dataLimits:
      "Logged activities only. Missing entries or metrics are unmeasured. Pace/speed uses the supplied duration and distance. Activity calories are reported values, not calculated expenditure, and are separate from food intake.",
  };
}
