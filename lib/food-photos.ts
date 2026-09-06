import sharp from "sharp";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { foodPhotos, journals } from "./db/schema";
import { ApiError } from "./agent/http";
import { readJournal } from "./server";
import { foodDate } from "./nutrition";

export const photoUploadSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(160),
    date: foodDate,
    image: z
      .string()
      .min(1)
      .max(2800000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
const fields = {
  id: foodPhotos.id,
  label: foodPhotos.label,
  date: foodPhotos.date,
  bytes: foodPhotos.bytes,
  createdAt: foodPhotos.createdAt,
};
export async function normalizeFoodPhoto(input: Buffer) {
  if (input.length > 2 * 1024 * 1024)
    throw new ApiError("Choose a photo smaller than 2 MB.", 413);
  try {
    const decoder = sharp(input, {
      limitInputPixels: 20000000,
      animated: false,
    });
    const meta = await decoder.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      throw Error("unsupported");
    // Re-encode pixels: strips EXIF, GPS, filenames and embedded metadata.
    const data = await decoder
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 78 })
      .toBuffer();
    if (data.length > 800000) throw Error("too large");
    return data;
  } catch {
    throw new ApiError(
      "Choose a valid JPEG, PNG or WebP photo. Try a smaller image if it cannot be read.",
      415,
    );
  }
}
export async function listFoodPhotos(userId: string) {
  return getDb()
    .select(fields)
    .from(foodPhotos)
    .where(eq(foodPhotos.userId, userId))
    .orderBy(desc(foodPhotos.date), desc(foodPhotos.createdAt));
}
export async function readFoodPhoto(userId: string, id: string) {
  const [photo] = await getDb()
    .select()
    .from(foodPhotos)
    .where(and(eq(foodPhotos.userId, userId), eq(foodPhotos.id, id)));
  if (!photo) throw new ApiError("Photo not found in your library.", 404);
  return photo;
}
export async function saveFoodPhoto(userId: string, raw: unknown) {
  const input = photoUploadSchema.parse(raw);
  const data = await normalizeFoodPhoto(Buffer.from(input.image, "base64"));
  const digest = createHash("sha256").update(data).digest("hex");
  await readJournal(userId);
  return getDb().transaction(async (tx) => {
    // The account journal lock serialises quota checks and simultaneous uploads.
    await tx
      .select({ id: journals.userId })
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    const [prior] = await tx
      .select()
      .from(foodPhotos)
      .where(and(eq(foodPhotos.userId, userId), eq(foodPhotos.id, input.id)));
    if (prior) {
      if (
        prior.digest !== digest ||
        prior.label !== input.label ||
        prior.date !== input.date
      )
        throw new ApiError(
          "This upload identifier has already been used.",
          409,
        );
      return {
        id: prior.id,
        label: prior.label,
        date: prior.date,
        bytes: prior.bytes,
        createdAt: prior.createdAt,
      };
    }
    const [usage] = await tx
      .select({
        bytes: sql<number>`coalesce(sum(${foodPhotos.bytes}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(foodPhotos)
      .where(eq(foodPhotos.userId, userId));
    if (
      Number(usage.bytes) + data.length > 250 * 1024 * 1024 ||
      usage.count >= 1000
    )
      throw new ApiError(
        "Your photo library is full (1,000 photos or 250 MB). Download and remove photos to make room.",
        413,
      );
    const [photo] = await tx
      .insert(foodPhotos)
      .values({
        userId,
        id: input.id,
        label: input.label,
        date: input.date,
        bytes: data.length,
        digest,
        data,
      })
      .returning(fields);
    return photo;
  });
}
export async function deleteFoodPhoto(userId: string, id: string) {
  // Keep meal references explicit. Removing a catalog photo never silently changes a meal.
  return getDb().transaction(async (tx) => {
    const [journal] = await tx
      .select()
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    if (journal?.state.nutrition?.meals.some((m) => m.photoIds.includes(id)))
      throw new ApiError(
        "This photo is linked to a meal. Edit that meal and remove its photo first, then sync.",
        409,
      );
    const deleted = await tx
      .delete(foodPhotos)
      .where(and(eq(foodPhotos.userId, userId), eq(foodPhotos.id, id)))
      .returning({ id: foodPhotos.id });
    if (!deleted.length)
      throw new ApiError("Photo not found in your library.", 404);
  });
}
