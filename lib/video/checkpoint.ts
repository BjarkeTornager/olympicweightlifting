import type { VideoAnalysis } from "./types";

export const VIDEO_REFINEMENT_VERSION = 5;

// Server-only storage, never selected by the public video DTO. Keep only one
// attempt's refined evidence; discard it after coaching succeeds or reanalysis.
export type VideoRefinementCheckpoint = {
  version: 1 | 2 | 3 | 4 | 5;
  reviewVersion: number;
  attemptId: string;
  start: number;
  end: number;
  sampleTimes: number[];
  frames: string[];
  pose?: VideoAnalysis["pose"];
  overlayRecovery?: {
    pose: VideoAnalysis["pose"];
    tracking: VideoAnalysis["tracking"];
  };
  segmentation?: VideoAnalysis["segmentation"];
  sam3Job?: import("./sam3").Sam3Job;
  body?: VideoAnalysis["body"];
  bodyJob?: import("./gpu-job").GpuJob;
  reviewed?: Pick<VideoAnalysis, "identification" | "coaching">;
  failure?: import("./review").ReviewDiagnostic;
};
