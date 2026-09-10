export const VIDEO_FRAME_COUNT = 24;
export const VIDEO_SHEET_COUNT = 4;
export const VIDEO_MAX_SECONDS = 6;
export const videoLifts = [
  "Snatch",
  "Clean",
  "Jerk",
  "Clean & jerk",
  "Other lifting movement",
] as const;
export type VideoLift = (typeof videoLifts)[number];

export function videoSampleTimes(start: number, end: number, duration: number) {
  if (
    ![start, end, duration].every(Number.isFinite) ||
    duration <= 0 ||
    duration > 120 ||
    start < 0 ||
    end > duration ||
    end - start < 0.5 ||
    end - start > VIDEO_MAX_SECONDS
  )
    throw Error(
      "Choose between 0.5 and 6 seconds within your clip. For a longer clean & jerk, review the clean and jerk separately.",
    );
  // Avoid the exact end-of-stream, which some decoders render as a black frame.
  const last = Math.min(end, Math.max(start, duration - 0.02));
  return Array.from(
    { length: VIDEO_FRAME_COUNT },
    (_, i) => start + ((last - start) * i) / (VIDEO_FRAME_COUNT - 1),
  );
}
export function videoReviewPrompt(
  lift: VideoLift,
  load: string,
  question: string,
  times: number[],
  group: string,
) {
  if (
    !videoLifts.includes(lift) ||
    times.length !== VIDEO_FRAME_COUNT ||
    times.some((t) => !Number.isFinite(t) || t < 0)
  )
    throw Error("Invalid video review.");
  return `Review my ${lift.toLowerCase()} technique from these ${VIDEO_SHEET_COUNT} attached video-frame sheets (review ${group}). ${load.trim() ? `Reported load: ${load.trim().slice(0, 80)}.` : "Load not supplied."}
${question.trim().slice(0, 600) || "Help me choose one useful improvement to try."}
The ${VIDEO_FRAME_COUNT} sampled positions run from ${times[0].toFixed(2)}s to ${times.at(-1)!.toFixed(2)}s in the source clip. Read sheets 1–4 in order, each left-to-right then top-to-bottom. Labels are requested video seek times, not calibrated motion measurements. Original video and audio have not been uploaded. Read lifting_review and lifting_knowledge (technique); assess only what is visible, cite the supporting frame times and distinguish observations from possible explanations. Suggest one cue or suitable drill and a check for my next attempt if the evidence supports it. Say if the clip is unclear or misses the important phase. This is advice only; do not log training or change my program.`;
}
