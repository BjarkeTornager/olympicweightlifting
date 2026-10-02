import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { featureUse } from "./db/schema";

// Content-free usage counts: one row per account, feature and UTC day, holding
// only how many times the feature was used. Never what was said, eaten, logged
// or photographed. The owner reads them on the usage page to decide what to
// keep, merge or remove (docs/product-principles.md).

const featureName = /^[a-z0-9_.:-]{1,80}$/;

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Counts one use. It never delays or fails the request that triggered it: the
// write runs in the background and a failure is logged without account data.
export function countUse(
  userId: string,
  feature: string,
  now = new Date(),
): Promise<void> {
  if (!userId || !featureName.test(feature)) return Promise.resolve();
  return getDb()
    .insert(featureUse)
    .values({ userId, feature, day: utcDay(now), count: 1 })
    .onConflictDoUpdate({
      target: [featureUse.userId, featureUse.feature, featureUse.day],
      set: { count: sql`${featureUse.count} + 1` },
    })
    .then(
      () => undefined,
      (error: unknown) => {
        // Drizzle wraps the PostgreSQL error, which carries the code.
        const code =
          (error as { cause?: { code?: unknown } }).cause?.code ??
          (error as { code?: unknown }).code;
        console.warn(
          JSON.stringify({
            event: "feature_use_failed",
            feature,
            code: typeof code === "string" ? code : undefined,
          }),
        );
      },
    );
}
