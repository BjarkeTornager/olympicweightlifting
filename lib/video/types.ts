import { z } from "zod";
import { videoLifts } from "../lifting-video";
import { foodDate } from "../nutrition";
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const videoUploadSchema = z
  .object({
    id: z.string().uuid(),
    lift: z.enum(videoLifts),
    date: foodDate,
    load: z.string().trim().max(80).default(""),
    start: z.number().finite().min(0).max(119.5),
    end: z.number().finite().min(0.5).max(120),
    calibration: z
      .object({
        // Normalized coordinates in the displayed (rotation-corrected) frame at start.
        x: z.number().min(0.03).max(0.97),
        y: z.number().min(0.03).max(0.97),
        diameterPixelsRatio: z.number().min(0.02).max(0.6),
        diameterCm: z.number().min(5).max(100),
        sideView: z.literal(true),
        // Only report m/s when the user explicitly confirms real-time playback.
        realTime: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.end - v.start >= 0.5 && v.end - v.start <= 20,
    "Choose between 0.5 and 20 seconds.",
  );
export type VideoUpload = z.infer<typeof videoUploadSchema>;
export type TrackPoint = { t: number; x: number; y: number; score: number };
export type VideoAnalysis = {
  version: 1;
  width: number;
  height: number;
  duration: number;
  frameCount: number;
  sampleTimes: number[];
  tracking: {
    status: "not_requested" | "partial" | "tracked" | "unavailable";
    reason: string;
    points: TrackPoint[];
    coverage: number;
    // Coordinates remain normalized. Physical outputs are estimates in the image plane.
    horizontalRangeCm: number | null;
    riseCm: number | null;
    peakUpwardVelocity: number | null;
    velocities: { t: number; value: number }[];
  };
};
export type SavedVideoReview = {
  settings?: VideoUpload;
  id: string;
  lift: string;
  date: string;
  load: string;
  status: "queued" | "processing" | "ready" | "failed";
  stage: string;
  createdAt: string;
  error: string | null;
  feedback: string | null;
  analysis: VideoAnalysis | null;
  hasMedia: boolean;
};
