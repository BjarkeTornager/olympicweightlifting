import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { liftingVideos, journals } from "../db/schema";
import { readJournal } from "../server";
import { ApiError } from "../agent/http";
import { canonicalJson } from "../json";
import { mergeSegmentation, segmentationSchema } from "./segmentation";
import type { VideoRefinementCheckpoint } from "./checkpoint";
import { queuedVideoProgress } from "./progress";
import {
  MAX_VIDEO_BYTES,
  videoUploadSchema,
  videoReanalysisSchema,
  type SavedVideoReview,
  type VideoUpload,
} from "./types";
const owner = (userId: string, id: string) =>
  and(eq(liftingVideos.userId, userId), eq(liftingVideos.id, id));
const fields = {
  id: liftingVideos.id,
  input: liftingVideos.input,
  status: liftingVideos.status,
  stage: liftingVideos.stage,
  progress: liftingVideos.progress,
  createdAt: liftingVideos.createdAt,
  error: liftingVideos.error,
  feedback: liftingVideos.feedback,
  analysis: liftingVideos.analysis,
  hasMedia: sql<boolean>`${liftingVideos.media} IS NOT NULL`,
};
function present(
  row: {
    input: typeof liftingVideos.$inferSelect.input;
    createdAt: Date;
    status: string;
  } & Omit<SavedVideoReview, "lift" | "date" | "load" | "createdAt" | "status">,
): SavedVideoReview {
  const { input, ...rest } = row;
  return {
    ...rest,
    stage:
      row.status === "ready"
        ? row.analysis?.segmentation?.failure ||
          row.analysis?.segmentation?.reason.startsWith(
            "Object outlines could not be prepared",
          )
          ? "Partial review · outlines unavailable"
          : row.analysis?.coaching?.scope === "visible_phases"
            ? "Partial movement review"
            : row.stage
        : row.stage,
    settings: input,
    lift: input.lift,
    date: input.date,
    load: input.load,
    createdAt: row.createdAt.toISOString(),
    status: row.status as SavedVideoReview["status"],
  };
}
export async function listVideos(userId: string) {
  // Lists/Coach reads need the summary; large trajectories are fetched on opening
  // an individual review, not transferred on every queue poll.
  return (
    await getDb()
      .select({
        ...fields,
        analysis: sql<import("./types").VideoAnalysis | null>`
    CASE WHEN ${liftingVideos.analysis} IS NULL THEN NULL ELSE
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(${liftingVideos.analysis}, '{tracking}',
      (${liftingVideos.analysis}->'tracking') - 'points' - 'velocities' || '{"points":[],"velocities":[]}'::jsonb), '{pose,frames}', '[]'::jsonb), '{segmentation,frames}', '[]'::jsonb), '{body,frames}', '[]'::jsonb), '{body,motion,clips}', '[]'::jsonb)
    END`,
      })
      .from(liftingVideos)
      .where(eq(liftingVideos.userId, userId))
      .orderBy(desc(liftingVideos.createdAt))
      .limit(20)
  ).map(present);
}
export async function getVideo(userId: string, id: string) {
  const [row] = await getDb()
    .select({
      ...fields,
      // Older failed jobs kept successful outlines only in their private
      // checkpoint. Select geometry alone; never return source/contact sheets.
      checkpoint: sql<Pick<
        VideoRefinementCheckpoint,
        "reviewVersion" | "attemptId" | "start" | "end" | "segmentation"
      > | null>`
        CASE WHEN ${liftingVideos.refinement} IS NULL THEN NULL ELSE jsonb_build_object(
          'reviewVersion', ${liftingVideos.refinement}->'reviewVersion',
          'attemptId', ${liftingVideos.refinement}->'attemptId',
          'start', ${liftingVideos.refinement}->'start',
          'end', ${liftingVideos.refinement}->'end',
          'segmentation', ${liftingVideos.refinement}->'segmentation') END`,
    })
    .from(liftingVideos)
    .where(owner(userId, id));
  if (!row) throw new ApiError("Video review not found.", 404);
  const { checkpoint, ...visible } = row;
  if (
    checkpoint &&
    visible.analysis &&
    checkpoint.reviewVersion === visible.analysis.reviewVersion &&
    visible.analysis.attempts?.some(
      (a) =>
        a.id === checkpoint.attemptId &&
        a.start === checkpoint.start &&
        a.end === checkpoint.end,
    )
  ) {
    const segmentation = segmentationSchema.safeParse(checkpoint.segmentation);
    if (segmentation.success)
      visible.analysis = {
        ...visible.analysis,
        segmentation: mergeSegmentation(
          visible.analysis.segmentation,
          segmentation.data,
          checkpoint.start,
          checkpoint.end,
        ),
      };
  }
  return present(visible);
}
export async function saveVideo(userId: string, raw: unknown, source: Buffer) {
  const input = videoUploadSchema.parse(raw);
  if (!source.length || source.length > MAX_VIDEO_BYTES)
    throw new ApiError("Choose a video under 50 MB.", 413);
  // Accept only actual ISO BMFF or EBML headers, never playlists or external URLs.
  if (!(
    source.subarray(4, 8).toString() === "ftyp" ||
    source.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ))
    throw new ApiError("Choose an MP4, MOV or WebM video.", 415);
  const digest = createHash("sha256")
    .update(source)
    .update(canonicalJson(input))
    .digest("hex");
  await readJournal(userId);
  await getDb().transaction(async (tx) => {
    await tx
      .select({ id: journals.userId })
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    const [prior] = await tx
      .select({ digest: liftingVideos.digest })
      .from(liftingVideos)
      .where(owner(userId, input.id));
    if (prior) {
      if (prior.digest !== digest)
        throw new ApiError(
          "This upload ID was already used for another video.",
          409,
        );
      return;
    }
    const [usage] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${liftingVideos.bytes}),0)::bigint`,
        active: sql<number>`count(*) filter (where ${liftingVideos.status} in ('queued','processing'))::int`,
      })
      .from(liftingVideos)
      .where(eq(liftingVideos.userId, userId));
    if (usage.active >= 3)
      throw new ApiError(
        "Three video reviews are already processing. Wait for one to finish.",
        429,
      );
    if (
      usage.count >= 20 ||
      Number(usage.bytes) + MAX_VIDEO_BYTES > 500 * 1024 * 1024
    )
      throw new ApiError(
        "Your video library is full (20 clips or 500 MB). Download and remove a review to make room.",
        413,
      );
    await tx.insert(liftingVideos).values({
      userId,
      id: input.id,
      input,
      digest,
      source,
      bytes: MAX_VIDEO_BYTES,
      progress: queuedVideoProgress(),
    });
  });
  return getVideo(userId, input.id);
}
export async function deleteVideo(userId: string, id: string) {
  const rows = await getDb()
    .delete(liftingVideos)
    .where(owner(userId, id))
    .returning({ id: liftingVideos.id });
  if (!rows.length) throw new ApiError("Video review not found.", 404);
}
export async function retryVideo(userId: string, id: string) {
  return queueReview(userId, id);
}
export async function reanalyseVideo(userId: string, id: string, raw: unknown) {
  return queueReview(userId, id, videoReanalysisSchema.parse(raw).lift);
}
async function queueReview(
  userId: string,
  id: string,
  correctedLift?: VideoUpload["lift"],
) {
  await getDb().transaction(async (tx) => {
    await tx
      .select({ id: journals.userId })
      .from(journals)
      .where(eq(journals.userId, userId))
      .for("update");
    const [row] = await tx
      .select({
        status: liftingVideos.status,
        input: liftingVideos.input,
        analysis: liftingVideos.analysis,
      })
      .from(liftingVideos)
      .where(owner(userId, id));
    if (!row) throw new ApiError("Video review not found.", 404);
    if (row.status === "queued" || row.status === "processing") {
      if (correctedLift && correctedLift !== row.input.lift)
        throw new ApiError(
          "Wait for this review to finish before changing its lift type.",
          409,
        );
      return;
    }
    if (row.status !== "failed" && !(correctedLift && row.status === "ready"))
      throw new ApiError("This review is already complete.", 409);
    const [usage] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${liftingVideos.status} in ('queued','processing'))::int`,
      })
      .from(liftingVideos)
      .where(eq(liftingVideos.userId, userId));
    if (usage.active >= 3)
      throw new ApiError(
        "Three video reviews are already processing. Wait for one to finish.",
        429,
      );
    await tx
      .update(liftingVideos)
      .set({
        status: "queued",
        stage: correctedLift ? "Waiting to reanalyse" : "Waiting to retry",
        progress: queuedVideoProgress(),
        ...(correctedLift
          ? {
              // Keep the original upload digest: a repeated upload remains idempotent.
              input: { ...row.input, lift: correctedLift },
              analysis: row.analysis
                ? {
                    ...row.analysis,
                    reviewVersion: undefined,
                    overlayVersion: undefined,
                    identification: undefined,
                    coaching: undefined,
                    attempts: undefined,
                    body: undefined,
                  }
                : null,
              feedback: null,
              refinement: null,
            }
          : {}),
        error: null,
        attempts: 0,
        lease: null,
        leaseUntil: null,
      })
      .where(and(owner(userId, id), eq(liftingVideos.status, row.status)));
  });
  return getVideo(userId, id);
}
export async function videoMedia(userId: string, id: string) {
  const [row] = await getDb()
    .select({ media: liftingVideos.media })
    .from(liftingVideos)
    .where(owner(userId, id));
  if (!row?.media)
    throw new ApiError("Video playback is not available yet.", 404);
  return row.media;
}
export function mediaRange(value: string | null, length: number) {
  if (!value) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]))
    throw new ApiError("Invalid video range.", 416);
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, length - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
  if (
    ![start, end].every(Number.isSafeInteger) ||
    start < 0 ||
    start > end ||
    start >= length
  )
    throw new ApiError("Invalid video range.", 416);
  return { start, end, partial: true };
}
