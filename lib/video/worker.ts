import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../db";
import { liftingVideos, user } from "../db/schema";
import { callModel, ProviderError } from "../agent/provider";
import { ApiError } from "../agent/http";
import { userAllowed } from "../access";
import { processVideo, refineVideo, recoverVideoOverlays } from "./processor";
import {
  sam3ConfigurationForAccount,
  segmentVideo,
  SegmentationPending,
  type Sam3Configuration,
} from "./sam3";
import { bodyConfigurationForAccount, reconstructBody } from "./body-server";
import { listVideos } from "./store";
import { previousVideoFocus } from "./focus";
import { queuedVideoProgress, type VideoProgress } from "./progress";
import { MAX_VIDEO_BYTES, type VideoAnalysis } from "./types";
import { VIDEO_REVIEW_VERSION } from "./coaching";
import { ReviewValidationError } from "./review";
import {
  VIDEO_REFINEMENT_VERSION,
  type VideoRefinementCheckpoint,
} from "./checkpoint";
import { automaticFeedback } from "./feedback";
import { logFailure } from "../error-log";
export { reviewMessages } from "./review";
// Stored size of a review: playback media, sampled frames and analysis JSON.
function reviewBytes(
  media: Buffer | null | undefined,
  frames: string[],
  analysis: VideoAnalysis,
) {
  return (
    (media?.length ?? 0) +
    frames.reduce((n, f) => n + f.length, 0) +
    Buffer.byteLength(JSON.stringify(analysis))
  );
}
const stagePhase = (stage: string): VideoProgress["phase"] =>
  /tracked movement/.test(stage)
    ? "coaching"
    : /^Reviewing/.test(stage)
      ? "tracking"
      : "preparing";

export async function claimVideo() {
  // Expired leases survive process restarts. A lease token fences every subsequent write.
  await getPool().query(
    "UPDATE lifting_videos SET status='failed',stage='Review interrupted',error='Processing was interrupted repeatedly. Retry this review.',lease=NULL WHERE status='processing' AND lease_until<now() AND attempts>=3",
  );
  const token = randomUUID();
  const { rows } = await getPool().query<{ user_id: string; id: string }>(
    `WITH next AS (
    SELECT user_id,id FROM lifting_videos WHERE ((status='queued' AND (lease_until IS NULL OR lease_until<=now())) OR (status='processing' AND lease_until<now())) AND attempts<3
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE lifting_videos v SET status='processing',
    stage=CASE WHEN progress->>'startedAt' IS NULL THEN 'Preparing video' ELSE stage END,
    progress=COALESCE(progress,jsonb_build_object('queuedAt',$2::text)) ||
      jsonb_build_object('startedAt',COALESCE(progress->>'startedAt',$2::text),
        'updatedAt',$2::text,'phase',CASE WHEN progress->>'startedAt' IS NULL THEN 'preparing' ELSE progress->>'phase' END),
    lease=$1,lease_until=now()+interval '11 minutes',attempts=attempts+1
    FROM next WHERE v.user_id=next.user_id AND v.id=next.id RETURNING v.user_id,v.id`,
    [token, new Date().toISOString()],
  );
  return rows[0] ? { ...rows[0], token } : null;
}
export async function runVideoJob(
  job: NonNullable<Awaited<ReturnType<typeof claimVideo>>>,
  model = callModel,
  processor = processVideo,
  refiner = refineVideo,
  segmenter = segmentVideo,
  bodyReconstructor = reconstructBody,
  overlayRecoverer = recoverVideoOverlays,
) {
  const fence = and(
    eq(liftingVideos.userId, job.user_id),
    eq(liftingVideos.id, job.id),
    eq(liftingVideos.lease, job.token),
  );
  let segmentationConfig: Sam3Configuration = {};
  let bodyConfig: Sam3Configuration = {};
  const jobStarted = Date.now();
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(600000)]);
  const check = async () => {
    const [account] = await getDb()
      .select()
      .from(user)
      .where(eq(user.id, job.user_id));
    const [exists] = await getDb()
      .select({ id: liftingVideos.id })
      .from(liftingVideos)
      .where(fence);
    if (!account || !exists || !(await userAllowed(account))) {
      abort.abort();
      return false;
    }
    segmentationConfig = sam3ConfigurationForAccount(account);
    bodyConfig = bodyConfigurationForAccount(account);
    return true;
  };
  const monitor = setInterval(() => {
    void check().catch(() => abort.abort());
  }, 10000);
  monitor.unref();
  try {
    if (!(await check())) return;
    const [row] = await getDb().select().from(liftingVideos).where(fence);
    let progress: VideoProgress = {
      ...(row.progress ?? queuedVideoProgress()),
      bodyRequested: Boolean(bodyConfig.endpoint),
    };
    const advance = (
      phase: VideoProgress["phase"],
      updated?: VideoAnalysis,
    ) => {
      const now = new Date().toISOString();
      const pending = updated?.attempts?.findIndex((a) => !a.coaching);
      progress = {
        ...progress,
        phase,
        startedAt: progress.startedAt ?? now,
        updatedAt: now,
        ...(updated?.attempts?.length
          ? {
              attemptCount: updated.attempts.length,
              attempt:
                pending !== undefined && pending >= 0
                  ? pending + 1
                  : updated.attempts.length,
            }
          : {}),
        ...(phase === "ready" ? { completedAt: now } : {}),
      };
      return progress;
    };
    let refinement =
      row.analysis?.reviewVersion === VIDEO_REVIEW_VERSION
        ? row.refinement
        : null;
    let analysis = row.analysis,
      frames = row.frames;
    let media = row.media;
    if (!analysis || !frames) {
      if (!row.source)
        throw new ApiError("This video is unavailable. Upload it again.", 422);
      const output = await processor(row.source, row.input, signal);
      signal.throwIfAborted();
      analysis = output.analysis;
      frames = output.frames;
      media = output.media;
      refinement = null;
      await getDb()
        .update(liftingVideos)
        .set({
          analysis,
          frames,
          refinement: null,
          media: output.media,
          source: null,
          bytes: MAX_VIDEO_BYTES,
          stage: "Identifying the movement phases",
          progress: advance("preparing"),
        })
        .where(fence);
    }
    if (!(await check())) return;
    if (!media)
      throw new ApiError(
        "This video's playback is unavailable. Upload it again.",
        422,
      );
    // Each worker only waits briefly. A private receipt survives queue yields
    // and process restarts; the remote job has its own bounded lifetime.
    const segmentationBudget = {
      remainingMs: 90_000,
      deadlineMs: jobStarted + 480_000,
    };
    const bodyBudget = {
      remainingMs: 60_000,
      deadlineMs: jobStarted + 480_000,
    };
    const priorReviews = await listVideos(row.userId);
    const result = await automaticFeedback(
      row.input,
      analysis,
      frames,
      model,
      signal,
      async (updated, stage, clearRefinement) => {
        if (!(await check())) signal.throwIfAborted();
        await getDb()
          .update(liftingVideos)
          .set({
            analysis: updated,
            stage: refinement?.bodyJob
              ? "Preparing your 3D body overlay and suggested movement"
              : stage,
            progress: advance(
              refinement?.bodyJob ? "body" : stagePhase(stage),
              updated,
            ),
            ...(clearRefinement ? { refinement: null } : {}),
          })
          .where(fence);
        if (clearRefinement) refinement = null;
      },
      async (current, attempt) => {
        if (!(await check())) signal.throwIfAborted();
        const reusable =
          refinement?.version === VIDEO_REFINEMENT_VERSION &&
          refinement.reviewVersion === VIDEO_REVIEW_VERSION &&
          current.reviewVersion === VIDEO_REVIEW_VERSION &&
          refinement.attemptId === attempt.id &&
          refinement.start === attempt.start &&
          refinement.end === attempt.end;
        let saved: VideoRefinementCheckpoint;
        if (reusable) saved = refinement!;
        else {
          const refined = await refiner(media!, current, attempt, signal);
          signal.throwIfAborted();
          saved = {
            version: VIDEO_REFINEMENT_VERSION,
            reviewVersion: VIDEO_REVIEW_VERSION,
            attemptId: attempt.id,
            start: attempt.start,
            end: attempt.end,
            sampleTimes: refined.analysis.sampleTimes,
            frames: refined.frames,
            pose: refined.analysis.pose,
            segmentation: refined.analysis.segmentation,
          };
          const bytes =
            reviewBytes(media!, frames!, current) +
            Buffer.byteLength(JSON.stringify(saved));
          if (bytes > MAX_VIDEO_BYTES)
            throw new ApiError(
              "This review is too large. Try a shorter clip.",
              422,
            );
        }
        const save = async () => {
          if (!(await check())) signal.throwIfAborted();
          await getDb()
            .update(liftingVideos)
            .set({ refinement: saved })
            .where(fence);
          refinement = saved;
        };
        // Persist decoded evidence before dispatching any GPU work. A queued
        // receipt can then be resumed without decoding or uploading again.
        if (!reusable) await save();
        const detailed = {
          ...current,
          identification: attempt.identification,
          sampleTimes: saved.sampleTimes,
          pose: saved.pose,
          segmentation: saved.segmentation,
          body: saved.body,
        };
        if (!saved.segmentation) {
          await getDb()
            .update(liftingVideos)
            .set({
              stage: "Tracking your movement and preparing object outlines",
              progress: advance("tracking", current),
            })
            .where(fence);
          const segmentation = await segmenter(
            media!,
            detailed,
            signal,
            segmentationConfig,
            undefined,
            segmentationBudget,
            {
              job: saved.sam3Job,
              saveJob: async (job) => {
                saved = { ...saved, sam3Job: job };
                await save();
              },
            },
          );
          signal.throwIfAborted();
          saved = { ...saved, segmentation, sam3Job: undefined };
          await save();
          detailed.segmentation = segmentation;
        }
        if (!saved.overlayRecovery) {
          await getDb()
            .update(liftingVideos)
            .set({
              stage: "Following your body and the bar through the lift",
              progress: advance("tracking", current),
            })
            .where(fence);
          const merged = new Map(
            (current.pose?.frames ?? [])
              .filter((f) => f.t >= attempt.start && f.t <= attempt.end)
              .map((f) => [f.t, f]),
          );
          for (const frame of detailed.pose?.frames ?? [])
            merged.set(frame.t, frame);
          for (const t of saved.sampleTimes)
            merged.set(t, {
              t,
              points:
                detailed.pose?.frames.find((f) => Math.abs(f.t - t) < 0.00001)
                  ?.points ?? [],
            });
          const pose = detailed.pose
            ? {
                ...detailed.pose,
                frames: [...merged.values()].sort((a, b) => a.t - b.t),
              }
            : current.pose;
          const recovered = await overlayRecoverer(
            media!,
            { ...detailed, pose },
            signal,
          );
          signal.throwIfAborted();
          // Explicit calibrated tracking retains its measured path and scale.
          saved = {
            ...saved,
            overlayRecovery: {
              pose: recovered.pose,
              tracking: row.input.calibration
                ? current.tracking
                : recovered.tracking,
            },
          };
          await save();
        }
        detailed.pose = saved.overlayRecovery!.pose;
        detailed.tracking = saved.overlayRecovery!.tracking;
        detailed.overlayVersion = 1;
        const prepareBody = async (
          reviewed: NonNullable<VideoRefinementCheckpoint["reviewed"]>,
        ) => {
          // Persist feedback before the long GPU stage. A resumed body job must
          // not spend another model call or change the target beneath its receipt.
          if (!saved.reviewed) {
            saved = { ...saved, reviewed };
            await save();
          }
          if (!saved.body && bodyConfig.endpoint) {
            await getDb()
              .update(liftingVideos)
              .set({
                stage: "Preparing your 3D body overlay and suggested movement",
                progress: advance("body", current),
              })
              .where(fence);
            const body = await bodyReconstructor(
              media!,
              { ...detailed, ...reviewed },
              signal,
              bodyConfig,
              undefined,
              bodyBudget,
              {
                job: saved.bodyJob,
                saveJob: async (job) => {
                  saved = { ...saved, bodyJob: job };
                  await save();
                },
              },
            );
            signal.throwIfAborted();
            const named = body?.motion
              ? {
                  ...body,
                  motion: {
                    ...body.motion,
                    clips: body.motion.clips.map((c) => ({
                      ...c,
                      id: `${attempt.id}-${c.id}`,
                    })),
                  },
                }
              : body;
            saved = { ...saved, body: named, bodyJob: undefined };
            await save();
            detailed.body = body;
          }
          return saved.body;
        };
        return {
          analysis: detailed,
          frames: saved.frames,
          reviewed: saved.reviewed,
          prepareBody,
        };
      },
      (lift) =>
        previousVideoFocus(priorReviews, {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          lift,
        }),
    );
    analysis = result.analysis;
    const feedback = result.feedback;
    let bytes = reviewBytes(media, frames, analysis);
    if (bytes > MAX_VIDEO_BYTES && analysis.body) {
      analysis.body = {
        ...analysis.body,
        frames: [],
        motion: {
          version: 1,
          status: "unavailable",
          clips: [],
          reason:
            "This clip's movement comparison exceeded the storage limit. Try a shorter clip; your coaching and video are available.",
        },
        status: "unavailable",
        reason:
          "This clip's body overlay exceeded the review storage limit. Try a shorter clip for the shadow; your video and coaching are available.",
      };
      bytes = reviewBytes(media, frames, analysis);
    }
    if (bytes > MAX_VIDEO_BYTES)
      throw new ApiError("This review is too large. Try a shorter clip.", 422);
    await getDb()
      .update(liftingVideos)
      .set({
        status: "ready",
        progress: advance("ready", analysis),
        bytes,
        stage: analysis.segmentation?.failure
          ? "Partial review · outlines unavailable"
          : analysis.coaching?.scope === "visible_phases"
            ? "Partial movement review"
            : "Review ready",
        analysis,
        feedback,
        refinement: null,
        error: null,
        lease: null,
        leaseUntil: null,
      })
      .where(fence);
  } catch (error) {
    if (error instanceof SegmentationPending && !signal.aborted) {
      const [saved] = await getDb().select().from(liftingVideos).where(fence);
      if (!saved || !(await check())) return;
      await getDb()
        .update(liftingVideos)
        .set({
          status: "queued",
          progress: {
            ...(saved.progress ?? queuedVideoProgress()),
            updatedAt: new Date().toISOString(),
          },
          stage: saved.refinement?.bodyJob
            ? "Preparing your 3D body overlay · continuing automatically"
            : "Preparing object outlines · continuing automatically",
          error: null,
          lease: null,
          leaseUntil: new Date(Date.now() + 15_000),
          // Waiting for the same GPU input is not a failed processing attempt.
          attempts: Math.max(0, saved.attempts - 1),
        })
        .where(fence);
      return;
    }
    logFailure(
      "video_job_failed",
      error,
      {
        video: job.id,
        reason: signal.aborted
          ? "interrupted"
          : error instanceof ApiError
            ? "review_error"
            : "processing_or_provider_error",
      },
      "warn",
    );
    const [saved] = await getDb().select().from(liftingVideos).where(fence);
    // A deleted/revoked account or superseded lease must never restart a job.
    if (!saved || !(await check())) return;
    const recoverable =
      error instanceof ReviewValidationError ||
      (error instanceof ProviderError &&
        (error.status === 429 || error.status >= 500)) ||
      (signal.aborted && !abort.signal.aborted);
    const retry = recoverable && saved.attempts < 3;
    // Save fixed diagnostic codes, never provider responses, inside the private
    // checkpoint so a deployment/log-retention boundary cannot erase the cause.
    await getDb()
      .update(liftingVideos)
      .set({
        status: retry ? "queued" : "failed",
        progress: {
          ...(saved.progress ?? queuedVideoProgress()),
          updatedAt: new Date().toISOString(),
        },
        stage: retry
          ? "Finishing Coach’s feedback automatically"
          : error instanceof ProviderError && error.status === 402
            ? "Coach’s AI allowance is used up"
            : "Feedback needs attention",
        error: retry
          ? null
          : error instanceof ApiError || error instanceof ProviderError
            ? error.message
            : "Coach could not finish this review. Your saved video is safe; retry shortly.",
        lease: null,
        leaseUntil: retry
          ? new Date(Date.now() + 30_000 * saved.attempts)
          : null,
        ...(error instanceof ReviewValidationError && saved.refinement
          ? { refinement: { ...saved.refinement, failure: error.diagnostic } }
          : {}),
      })
      .where(fence);
  } finally {
    clearInterval(monitor);
  }
}
let started = false;
export function startVideoWorker() {
  if (
    started ||
    process.env.VIDEO_ANALYSIS_WORKER !== "1" ||
    !process.env.DATABASE_URL
  )
    return;
  started = true;
  const poll = async () => {
    try {
      const job = await claimVideo();
      if (job) await runVideoJob(job);
    } catch {
      console.error(JSON.stringify({ event: "video_worker_unavailable" }));
    }
    setTimeout(() => void poll(), 5000).unref();
  };
  void poll();
}
