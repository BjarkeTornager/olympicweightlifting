import sharp from "sharp";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { foodPhotos, journals } from "./db/schema";
import { ApiError } from "./agent/http";
import { readJournal } from "./server";
import { foodDate } from "./nutrition";
import {
  imagePatchSchema,
  unclassifiedImage,
  type ImageCategory,
  type ImageClassification,
} from "./images";
import { classifyImage } from "./image-classifier";
import { callModel } from "./agent/provider";

export const imageUploadSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(160),
    date: foodDate,
    // Older clients did not disclose automatic provider processing.
    autoTag: z.boolean().default(false),
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
  category: foodPhotos.category,
  classification: foodPhotos.classification,
  version: foodPhotos.version,
};
export async function normalizeImage(input: Buffer) {
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
export async function listUserImages(userId: string, category?: ImageCategory) {
  return getDb()
    .select(fields)
    .from(foodPhotos)
    .where(
      and(
        eq(foodPhotos.userId, userId),
        category ? eq(foodPhotos.category, category) : undefined,
      ),
    )
    .orderBy(desc(foodPhotos.date), desc(foodPhotos.createdAt));
}
export async function readUserImage(userId: string, id: string) {
  const [photo] = await getDb()
    .select()
    .from(foodPhotos)
    .where(and(eq(foodPhotos.userId, userId), eq(foodPhotos.id, id)));
  if (!photo) throw new ApiError("Image not found in your library.", 404);
  return photo;
}
export async function saveUserImage(
  userId: string,
  raw: unknown,
  model = callModel,
) {
  const input = imageUploadSchema.parse(raw);
  const data = await normalizeImage(Buffer.from(input.image, "base64"));
  const digest = createHash("sha256").update(data).digest("hex");
  await readJournal(userId);
  const saved = await getDb().transaction(async (tx) => {
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
        fresh: false,
        photo: {
          id: prior.id,
          label: prior.label,
          date: prior.date,
          bytes: prior.bytes,
          createdAt: prior.createdAt,
          category: prior.category,
          classification: prior.classification,
          version: prior.version,
        },
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
        classification: input.autoTag
          ? { ...unclassifiedImage, source: "automatic", status: "pending" }
          : unclassifiedImage,
      })
      .returning(fields);
    return { fresh: true, photo };
  });
  // Persist bytes before the provider call; never hold database locks during inference.
  if (saved.fresh && input.autoTag)
    return tagUserImage(userId, input.id, saved.photo.version, model);
  return saved.photo;
}
export async function deleteUserImage(userId: string, id: string) {
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
      throw new ApiError("Image not found in your library.", 404);
  });
}

export async function imageMetadata(userId: string, id: string) {
  const [photo] = await getDb()
    .select(fields)
    .from(foodPhotos)
    .where(and(eq(foodPhotos.userId, userId), eq(foodPhotos.id, id)));
  if (!photo) throw new ApiError("Image not found in your library.", 404);
  return photo;
}

async function updateCategory(
  userId: string,
  id: string,
  version: number,
  category: ImageCategory,
  classification: ImageClassification,
) {
  return getDb().transaction(async (tx) => {
    // Serialise against journal writes/deletes to protect meal attachment categories.
    const [journal] = await tx
      .select()
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    if (
      category !== "food" &&
      journal?.state.nutrition?.meals.some((m) => m.photoIds.includes(id))
    )
      throw new ApiError(
        "This image is linked to a meal. Remove its photo link in Food and sync before changing the category.",
        409,
      );
    const [photo] = await tx
      .update(foodPhotos)
      .set({ category, classification, version: version + 1 })
      .where(
        and(
          eq(foodPhotos.userId, userId),
          eq(foodPhotos.id, id),
          eq(foodPhotos.version, version),
        ),
      )
      .returning(fields);
    if (!photo)
      throw new ApiError(
        "This image changed or was removed. Refresh the library before trying again.",
        409,
      );
    return photo;
  });
}

export async function patchUserImage(userId: string, id: string, raw: unknown) {
  const input = imagePatchSchema.parse(raw);
  await imageMetadata(userId, id);
  return updateCategory(userId, id, input.version, input.category, {
    tags: input.tags,
    confidence: "high",
    source: "manual",
    status: input.category === "unclassified" ? "review" : "ready",
  });
}

export async function tagUserImage(
  userId: string,
  id: string,
  version: number,
  model = callModel,
) {
  const photo = await readUserImage(userId, id);
  if (photo.version !== version)
    throw new ApiError(
      "This image changed. Refresh before tagging it again.",
      409,
    );
  let result: { category: ImageCategory; classification: ImageClassification };
  try {
    result = await classifyImage(photo.data, model);
  } catch {
    // Failure never loses a saved image or defaults it to food. Failed retags keep the prior category.
    result = {
      category: photo.category,
      classification: { ...photo.classification, status: "failed" },
    };
  }
  try {
    return await updateCategory(
      userId,
      id,
      version,
      result.category,
      result.classification,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const current = await imageMetadata(userId, id);
      if (current.version !== version) return current; // A user's edit wins an in-flight model response.
    }
    throw error;
  }
}
