/** Local clock context for inference; timestamps are not confirmed eating times. */
export function localClock(at: Date | string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: ["year", "month", "day"].map(value).join("-"),
    time: ["hour", "minute"].map(value).join(":"),
    timezone,
  };
}

export function imageTiming(
  image: { date: string; createdAt: Date | string },
  timezone: string,
) {
  const uploadedLocal = localClock(image.createdAt, timezone);
  return {
    libraryDate: image.date,
    uploadedAt: new Date(image.createdAt).toISOString(),
    uploadedLocal,
    // Backdated library images must not inherit today's upload hour as meal time.
    mealTimeHint: image.date === uploadedLocal.date ? uploadedLocal.time : null,
    timingNote:
      "Upload timing is a weak clue, not a confirmed eating or capture time.",
  };
}
