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

// A presentation label for generated reviews, never an authorization signal.
export function videoFeedbackLabel(message: string, photoCount: number) {
  if (photoCount !== VIDEO_SHEET_COUNT) return null;
  const lift = videoLifts.find((name) =>
    message.startsWith(
      `Give me feedback on my ${name.toLowerCase()} from these 4 attached video-frame sheets (review `,
    ),
  );
  return lift &&
    message.includes(
      "Review the lift proactively; do not ask me to choose a question",
    )
    ? `${lift} · Video feedback`
    : null;
}

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
  times: number[],
  group: string,
) {
  if (
    !videoLifts.includes(lift) ||
    times.length !== VIDEO_FRAME_COUNT ||
    times.some((t) => !Number.isFinite(t) || t < 0)
  )
    throw Error("Invalid video review.");
  return `Give me feedback on my ${lift.toLowerCase()} from these ${VIDEO_SHEET_COUNT} attached video-frame sheets (review ${group}). ${load.trim() ? `Reported load: ${load.trim().slice(0, 80)}.` : "Load not supplied; assess visible technique without requiring it."}
Review the lift proactively; do not ask me to choose a question or identify a fault first. Use a short, structured review: What went well, Main improvement, Next attempt. Ground both strengths and the single highest-priority improvement in visible evidence, with frame times. Give one practical cue or suitable drill and what to check on the next attempt. Do not invent praise or a fault to fill the structure; say when the evidence does not support a correction.
The ${VIDEO_FRAME_COUNT} sampled positions run from ${times[0].toFixed(2)}s to ${times.at(-1)!.toFixed(2)}s in the source clip. Read sheets 1–4 in order, each left-to-right then top-to-bottom. Labels are requested video seek times, not calibrated motion measurements. Original video and audio have not been uploaded. Read lifting_review and lifting_knowledge (technique); assess only what is visible and distinguish observations from possible explanations. If the clip is unclear or misses the important phase, explain what cannot be assessed and how to film a more useful clip. This is advice only; do not log training or change my program.`;
}
