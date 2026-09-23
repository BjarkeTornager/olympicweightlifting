import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAttempts } from "../lib/video/feedback";
import type { VideoAnalysis, VideoUpload } from "../lib/video/types";
import type { VideoAttempt } from "../lib/video/attempts";

const identification = (
  lift: VideoAttempt["identification"]["lift"],
): VideoAttempt["identification"] => ({
  version: 1,
  lift,
  status: lift ? "supported" : "uncertain",
  reason: lift ? "" : "The bar leaves the frame.",
  phases: [],
});
const moment = (id: string, start: number, end: number) =>
  ({
    id,
    title: id,
    observation: "The bar drifts forward.",
    cue: "Keep it close.",
    check: "Bar stays over the midfoot.",
    evidenceTime: start + 0.5,
    start,
    end,
  }) as unknown as NonNullable<VideoAttempt["coaching"]>["moments"][number];
const input = { lift: "Identify from video" } as VideoUpload;
const summarize = (attempts: VideoAttempt[]) =>
  summarizeAttempts(
    { attempts, reviewVersion: 0 } as unknown as VideoAnalysis,
    input,
  );

test("one attempt keeps its coaching unlabelled", () => {
  const { analysis, feedback } = summarize([
    {
      id: "attempt-1",
      start: 0,
      end: 4,
      identification: identification("Snatch"),
      coaching: {
        version: 2,
        strength: "Patient pull.",
        limitation: "",
        moments: [moment("m1", 1, 2)],
      },
    },
  ]);
  assert.equal(analysis.identification?.lift, "Snatch");
  assert.equal(analysis.coaching?.strength, "Patient pull.");
  assert.equal(analysis.coaching?.moments[0].id, "attempt-1-m1");
  assert.equal(analysis.coaching?.moments[0].attemptLabel, "");
  assert.equal(analysis.overlayVersion, 1);
  assert.match(feedback, /Movement review: Snatch/);
  assert.doesNotMatch(feedback, /---/);
});

test("several attempts are labelled, clamped to their time and joined in order", () => {
  const { analysis, feedback } = summarize([
    {
      id: "attempt-1",
      start: 0,
      end: 4,
      identification: identification("Clean"),
      coaching: {
        version: 2,
        strength: "Fast turnover.",
        limitation: "",
        scope: "visible_phases",
        moments: [moment("m1", -1, 6)],
      },
    },
    {
      id: "attempt-2",
      start: 5,
      end: 9,
      identification: identification(null),
    },
  ]);
  const coaching = analysis.coaching!;
  assert.equal(coaching.strength, "Attempt 1 · Clean: Fast turnover.");
  // An unidentified attempt still explains why it wasn't reviewed.
  assert.equal(
    coaching.limitation,
    "Attempt 2 · Visible movement: The bar leaves the frame.",
  );
  assert.equal(coaching.scope, "visible_phases");
  assert.deepEqual(
    coaching.moments.map((m) => [m.id, m.start, m.end, m.attemptLabel]),
    [["attempt-1-m1", 0, 4, "Attempt 1 · Clean"]],
  );
  assert.equal(feedback.split("\n\n---\n\n").length, 2);
  assert.match(feedback, /A closer look is needed/);
});
