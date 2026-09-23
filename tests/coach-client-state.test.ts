import { test } from "node:test";
import assert from "node:assert/strict";
import { coachEntryIntent } from "../lib/coach-entry";
import {
  applyStreamUpdate,
  markProposal,
  mergeSavedTurns,
  type Turn,
} from "../lib/coach-turns";
import {
  coachBackgroundStatus,
  coachConnectionHint,
} from "../lib/coach-status";
import {
  proposalNeedsReview,
  proposalRoute,
  proposalRouteLabel,
} from "../lib/coach-proposals";
import { emptyJournal } from "../lib/domain";
import type { ActionPreview } from "../lib/agent/actions";
import type { SavedVisual } from "../lib/coach-visuals";

const turn = (id: string, extra: Partial<Turn> = {}): Turn => ({
  id,
  question: `Question ${id}`,
  status: "done",
  ...extra,
});
const visual = (id: string) =>
  ({
    id,
    content: { kind: "table", title: id, columns: [], rows: [] },
  }) as unknown as SavedVisual;
const preview = (extra: Partial<ActionPreview> = {}): ActionPreview => ({
  id: "proposal",
  title: "A change",
  detail: "",
  workout: null,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  ...extra,
});

test("Coach links open the matching entry, and an in-memory draft wins over a route prompt", () => {
  const state = emptyJournal();
  assert.equal(coachEntryIntent("coach/capture", state).initialCapture, true);
  assert.equal(coachEntryIntent("coach/plans", state).initialMemories, "plans");
  assert.equal(
    coachEntryIntent("coach/memories", state).initialMemories,
    "memories",
  );
  const video = coachEntryIntent("coach/lifting/video", state);
  assert.equal(video.initialVideoReview, true);
  assert.equal(video.initialTrainingPrompt, undefined);
  assert.match(
    coachEntryIntent("coach/training/new", state).initialTrainingPrompt!,
    /reusable training program/,
  );
  assert.match(
    coachEntryIntent("coach/training/missing-id", state).initialTrainingPrompt!,
    /“my program”/,
  );
  assert.equal(
    coachEntryIntent("coach/training/new", state, "My own words")
      .initialTrainingPrompt,
    "My own words",
  );
  const activity = coachEntryIntent("coach/photo/abc/cardio/log", state);
  assert.equal(activity.initialPhotoId, "abc");
  assert.equal(activity.initialCardioLog, true);
  assert.equal(activity.initialActivityPhotoLog, true);
  const sleep = coachEntryIntent("coach/photo/abc/sleep", state);
  assert.equal(sleep.initialSleepLog, true);
  assert.equal(sleep.initialCardioLog, false);
  assert.deepEqual(coachEntryIntent("coach", state), {
    initialCapture: false,
    initialMemories: undefined,
    initialVideoReview: false,
    initialTrainingPrompt: undefined,
    initialCardioLog: false,
    initialActivityPhotoLog: false,
    initialSleepLog: false,
    initialPhotoId: undefined,
  });
});

test("saved turns load ahead of local ones without duplicating a turn", () => {
  const local = [turn("b", { status: "running" }), turn("c")];
  const merged = mergeSavedTurns([turn("a"), turn("b")], local);
  assert.deepEqual(
    merged.map((t) => [t.id, t.status]),
    [
      ["a", "done"],
      ["b", "running"],
      ["c", "done"],
    ],
  );
});

test("streamed updates replace the reply, keep earlier fields and show at most three distinct visuals", () => {
  let t = turn("a", { reply: "Old", activity: "Reading" });
  t = applyStreamUpdate(t, { reply: "" });
  assert.equal(t.reply, "");
  assert.equal(t.activity, "Reading");
  t = applyStreamUpdate(t, { activity: "" });
  assert.equal(t.activity, "Reading");
  for (const id of ["1", "2", "2", "3", "4"])
    t = applyStreamUpdate(t, { visual: visual(id) });
  assert.deepEqual(
    t.visuals!.map((v) => v.id),
    ["1", "2", "3"],
  );
});

test("undoing a directly saved entry replaces its reply; a reviewed save keeps it", () => {
  const turns = [
    turn("direct", {
      reply: "Saved to your journal.",
      proposals: [preview({ id: "p1", status: "saved", automatic: true })],
    }),
    turn("reviewed", {
      reply: "Ready for your review.",
      proposals: [preview({ id: "p2", status: "saved" })],
    }),
  ];
  const undone = markProposal(turns, "p1", "undone", true);
  assert.match(undone[0].reply!, /^Undone\./);
  assert.equal(undone[0].proposals![0].status, "undone");
  assert.equal(undone[1].reply, "Ready for your review.");
  const second = markProposal(undone, "p2", "undone", true);
  assert.equal(second[1].reply, "Ready for your review.");
  assert.equal(second[1].proposals![0].status, "undone");
  assert.equal(turns[0].proposals![0].status, "saved");
});

test("the send-blocked hint names the most urgent problem first", () => {
  const ready = {
    conflict: false,
    pending: false,
    journalStatus: "synced" as const,
    connectionError: "",
    connecting: false,
    enabled: true,
    loadingImage: false,
  };
  assert.equal(coachConnectionHint(ready), "");
  assert.match(
    coachConnectionHint({ ...ready, conflict: true, pending: true }),
    /Choose which journal version/,
  );
  assert.match(
    coachConnectionHint({ ...ready, pending: true, journalStatus: "offline" }),
    /Sync your pending changes/,
  );
  assert.match(
    coachConnectionHint({ ...ready, journalStatus: "offline" }),
    /You’re offline/,
  );
  assert.match(
    coachConnectionHint({ ...ready, journalStatus: "syncing" }),
    /hasn’t connected yet/,
  );
  assert.equal(
    coachConnectionHint({
      ...ready,
      connectionError: "Coach couldn’t connect.",
      connecting: true,
    }),
    "Coach couldn’t connect.",
  );
  assert.match(
    coachConnectionHint({ ...ready, connecting: true, enabled: false }),
    /Connecting to Coach/,
  );
  assert.match(
    coachConnectionHint({ ...ready, enabled: false }),
    /temporarily unavailable/,
  );
  assert.match(
    coachConnectionHint({ ...ready, loadingImage: true }),
    /Loading your attached image/,
  );
});

test("the background status reports a failure before work, and work before results", () => {
  const idle = {
    failed: false,
    busy: false,
    queued: 0,
    acting: false,
    preparingPhoto: false,
    result: null,
  };
  assert.equal(coachBackgroundStatus(idle), null);
  assert.equal(
    coachBackgroundStatus({ ...idle, failed: true, busy: true }),
    "Coach needs your attention",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, busy: true, queued: 2 }),
    "Coach is working… 2 queued",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, busy: true }),
    "Coach is working…",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, queued: 3, result: "ready" }),
    "3 messages waiting for Coach",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, acting: true }),
    "Coach is saving your change…",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, preparingPhoto: true }),
    "Coach is preparing your photo…",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, result: "ready" }),
    "Your Coach reply is ready",
  );
  assert.equal(
    coachBackgroundStatus({ ...idle, result: "failed" }),
    "Coach needs your attention",
  );
});

test("a proposal opens the screen that holds its entry", () => {
  const workout = (result: "" | "success") =>
    ({
      exercises: [{ sets: [{ result }] }],
    }) as unknown as ActionPreview["workout"];
  assert.equal(proposalRoute(preview({ entries: [] })), "today");
  assert.equal(
    proposalRoute(preview({ liftingBrief: null })),
    "workout/coaching",
  );
  assert.equal(
    proposalRouteLabel(preview({ liftingBrief: null })),
    "Open lifting coach",
  );
  assert.equal(
    proposalRoute(preview({ targets: {} as ActionPreview["targets"] })),
    "food",
  );
  assert.equal(
    proposalRoute(preview({ workoutReview: { status: "ongoing" } })),
    "workout",
  );
  assert.equal(
    proposalRouteLabel(preview({ workoutReview: { status: "ongoing" } })),
    "Open ongoing workout",
  );
  assert.equal(
    proposalRoute(preview({ workoutReview: { status: "completed" } })),
    "history",
  );
  assert.equal(proposalRoute(preview({ workout: workout("") })), "workout");
  assert.equal(
    proposalRoute(preview({ workout: workout("success") })),
    "history",
  );
  assert.equal(proposalRoute(preview()), "history");
  assert.equal(proposalRouteLabel(preview()), "Open journal");
});

test("only unsaved, unexpired proposals need review", () => {
  const now = Date.now();
  assert.equal(proposalNeedsReview(preview(), now), true);
  assert.equal(proposalNeedsReview(preview({ status: "saved" }), now), false);
  assert.equal(
    proposalNeedsReview(
      preview({ expiresAt: new Date(now - 1).toISOString() }),
      now,
    ),
    false,
  );
});
