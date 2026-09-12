import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import type { VideoAnalysis } from "../lib/video/types";
config({ path: ".env.local", quiet: true });
test(
  "private videos: idempotent uploads, lease fencing, retries without redecoding, owner isolation and deletion",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const {
      saveVideo,
      getVideo,
      listVideos,
      deleteVideo,
      retryVideo,
      reanalyseVideo,
      videoMedia,
    } = await import("../lib/video/store");
    const { claimVideo, runVideoJob } = await import("../lib/video/worker");
    const { readJournal } = await import("../lib/server");
    const pool = getPool(),
      users = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of users)
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic video',$1||'@example.test',true)",
        [id],
      );
    // Synthetic invitations permit the worker without changing the owner's allowlist.
    for (const id of users)
      await pool.query(
        "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
        [crypto.randomUUID(), `${id}@example.test`, users[0]],
      );
    try {
      const input = {
        id: crypto.randomUUID(),
        lift: "Identify from video",
        date: "2026-09-11",
        start: 0,
        end: 2,
      };
      const source = await readFile("tests/fixtures/lifting-motion.mp4");
      await saveVideo(users[0], input, source);
      await saveVideo(users[0], input, source);
      assert.equal((await listVideos(users[0])).length, 1);
      assert.equal((await listVideos(users[1])).length, 0);
      await assert.rejects(getVideo(users[1], input.id), /not found/);
      await assert.rejects(videoMedia(users[1], input.id), /not available/);
      await assert.rejects(deleteVideo(users[1], input.id), /not found/);
      await assert.rejects(retryVideo(users[1], input.id), /not found/);
      await assert.rejects(
        reanalyseVideo(users[1], input.id, { lift: "Clean & jerk" }),
        /not found/,
      );
      await assert.rejects(
        saveVideo(users[0], { ...input, lift: "Snatch" }, source),
        /already used/,
      );
      await assert.rejects(
        saveVideo(
          users[0],
          { ...input, id: crypto.randomUUID() },
          Buffer.from("#EXTM3U\nhttps://example.test/private"),
        ),
        /MP4/,
      );
      const job = await claimVideo();
      assert.ok(job);
      assert.equal(await claimVideo(), null);
      const analysis: VideoAnalysis = {
        version: 1,
        width: 320,
        height: 480,
        duration: 2,
        frameCount: 60,
        sampleTimes: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        tracking: {
          status: "not_requested",
          reason: "No marker",
          points: [],
          coverage: 0,
          horizontalRangeCm: null,
          riseCm: null,
          peakUpwardVelocity: null,
          velocities: [],
        },
      };
      let decodes = 0;
      const processor = async () => {
        decodes++;
        return { analysis, frames: ["test"], media: source };
      };
      await runVideoJob(
        job,
        async () => {
          throw Error("synthetic provider unavailable");
        },
        processor,
      );
      assert.equal((await getVideo(users[0], input.id)).status, "failed");
      assert.deepEqual(await videoMedia(users[0], input.id), source);
      const stored = await pool.query(
        "SELECT source FROM lifting_videos WHERE user_id=$1 AND id=$2",
        [users[0], input.id],
      );
      assert.equal(stored.rows[0].source, null);
      await retryVideo(users[0], input.id);
      const retry = await claimVideo();
      assert.ok(retry);
      let modelCalls = 0;
      const phaseReply = JSON.stringify({
        visibility: "sufficient",
        limitation: "",
        phases: [
          {
            kind: "pull",
            frame: 1,
            evidence: "The bar is moving up from below the knee.",
          },
          {
            kind: "front_rack_receive",
            frame: 3,
            evidence: "The bar is received on the front shoulders.",
          },
          {
            kind: "leg_drive_from_rack",
            frame: 6,
            evidence: "A separate dip and leg drive starts from the rack.",
          },
          {
            kind: "overhead_receive",
            frame: 8,
            evidence: "The bar is received with arms overhead.",
          },
        ],
      });
      await runVideoJob(
        retry,
        async (messages, tools) => {
          assert.deepEqual(tools, []);
          assert.equal(messages[1].images?.length, 1);
          modelCalls++;
          if (modelCalls === 1)
            assert.equal(messages[1].content.includes('"lift"'), false);
          else
            assert.equal(JSON.parse(messages[1].content).lift, "Clean & jerk");
          return {
            role: "assistant",
            content:
              modelCalls === 1 ? phaseReply : "This is a clear snatch attempt.",
          };
        },
        processor,
      );
      assert.equal(decodes, 1);
      assert.equal(modelCalls, 2);
      const guarded = await getVideo(users[0], input.id);
      assert.match(guarded.feedback!, /withheld/);
      assert.doesNotMatch(guarded.feedback!, /clear snatch/);
      assert.equal(guarded.analysis?.identification?.lift, "Clean & jerk");
      await reanalyseVideo(users[0], input.id, { lift: "Clean & jerk" });
      assert.equal((await getVideo(users[0], input.id)).feedback, null);
      assert.equal(
        (await getVideo(users[0], input.id)).analysis?.identification,
        undefined,
      );
      await assert.rejects(
        reanalyseVideo(users[0], input.id, { lift: "Snatch" }),
        /Wait/,
      );
      const corrected = await claimVideo();
      assert.ok(corrected);
      let correctedCalls = 0;
      await runVideoJob(
        corrected,
        async () => ({
          role: "assistant",
          content:
            ++correctedCalls === 1
              ? phaseReply
              : "The front-rack position is visible at 0.50s. No correction is justified by these synthetic frames.",
        }),
        processor,
      );
      assert.equal(correctedCalls, 2);
      assert.equal(decodes, 1);
      assert.equal((await getVideo(users[0], input.id)).lift, "Clean & jerk");
      // Correcting a review does not make an original upload replay create a duplicate.
      await saveVideo(users[0], input, source);
      assert.equal((await listVideos(users[0])).length, 1);
      assert.equal((await getVideo(users[0], input.id)).status, "ready");
      // Old worker cannot overwrite the later fenced result.
      await runVideoJob(
        job,
        async () => {
          throw Error("must not be called");
        },
        processor,
      );
      assert.equal((await getVideo(users[0], input.id)).status, "ready");
      assert.equal((await readJournal(users[0])).revision, 0);
      await deleteVideo(users[0], input.id);
      await assert.rejects(videoMedia(users[0], input.id), /not available/);
      // Automatic upload checkpoints identification and retries malformed coaching
      // without losing the private clip or leaking large pose tracks in list reads.
      const automatic = {
        ...input,
        id: crypto.randomUUID(),
        mode: "automatic",
        end: 120,
      };
      await saveVideo(users[0], automatic, source);
      const automaticJob = await claimVideo();
      assert.ok(automaticJob);
      const autoAnalysis: VideoAnalysis = {
        ...analysis,
        pose: {
          status: "partial",
          reason: "Synthetic",
          frames: [{ t: 0.5, points: [{ id: 13, x: 0.4, y: 0.5 }] }],
        },
      };
      const autoProcessor = async () => ({
        analysis: structuredClone(autoAnalysis),
        media: source,
        frames: ["coarse-synthetic"],
      });
      const refiner = async (
        _media: Buffer,
        current: VideoAnalysis,
        attempt: import("../lib/video/attempts").VideoAttempt,
      ) => ({
        analysis: { ...current, identification: attempt.identification },
        frames: ["dense-synthetic"],
      });
      const coaching = {
        strength: "The receiving position is visible.",
        limitation: "Synthetic footage only.",
        moments: [
          {
            title: "Receiving position",
            observation: "Synthetic visible evidence for the receiving phase.",
            cue: "A synthetic cue for the next attempt.",
            check: "Compare the next receiving frame.",
            region: "elbows",
            frames: [3],
          },
        ],
      };
      let autoCalls = 0;
      await runVideoJob(
        automaticJob,
        async (messages, tools) => {
          assert.deepEqual(tools, []);
          autoCalls++;
          if (autoCalls === 1)
            return {
              role: "assistant",
              content: JSON.stringify({
                attempts: [
                  {
                    startFrame: 1,
                    endFrame: 9,
                    evidence: JSON.parse(phaseReply),
                  },
                ],
              }),
            };
          assert.deepEqual(messages[1].images, ["dense-synthetic"]);
          return {
            role: "assistant",
            content: JSON.stringify({
              ...coaching,
              moments: [{ ...coaching.moments[0], frames: [999] }],
            }),
          };
        },
        autoProcessor,
        refiner,
      );
      assert.equal((await getVideo(users[0], automatic.id)).status, "failed");
      assert.equal(
        (await getVideo(users[0], automatic.id)).analysis?.attempts?.[0]
          .identification.lift,
        "Clean & jerk",
      );
      await retryVideo(users[0], automatic.id);
      const automaticRetry = await claimVideo();
      assert.ok(automaticRetry);
      await runVideoJob(
        automaticRetry,
        async (messages) => {
          autoCalls++;
          assert.deepEqual(messages[1].images, ["dense-synthetic"]);
          return { role: "assistant", content: JSON.stringify(coaching) };
        },
        async () => {
          throw Error("Must reuse saved media");
        },
        refiner,
      );
      const completed = await getVideo(users[0], automatic.id);
      assert.equal(completed.status, "ready");
      assert.equal(autoCalls, 3);
      assert.equal(completed.analysis?.coaching?.moments[0].evidenceTime, 0.5);
      assert.deepEqual(
        completed.analysis?.coaching?.moments[0].evidenceTimes,
        [0.5],
      );
      assert.equal(completed.analysis?.pose?.frames.length, 1);
      assert.deepEqual(
        (await listVideos(users[0]))[0].analysis?.pose?.frames,
        [],
      );
      await reanalyseVideo(users[0], automatic.id, {
        lift: "Identify from video",
      });
      assert.equal(
        (await getVideo(users[0], automatic.id)).analysis?.attempts,
        undefined,
      );
      assert.equal(
        (await getVideo(users[0], automatic.id)).analysis?.coaching,
        undefined,
      );
      await deleteVideo(users[0], automatic.id);
      // The reported regression: a visible front-rack hold used to skip the
      // coaching call entirely when the complete lift could not be named.
      for (const mode of ["automatic", "manual"] as const) {
        const partialInput = {
          ...input,
          id: crypto.randomUUID(),
          mode,
          end: mode === "automatic" ? 120 : 2,
        };
        await saveVideo(users[0], partialInput, source);
        const partialJob = await claimVideo();
        assert.ok(partialJob);
        let calls = 0;
        const partialEvidence = {
          visibility: "limited",
          limitation:
            "The bar is already at the front shoulders; the preceding pull is not visible.",
          phases: [
            {
              kind: "front_rack_hold",
              frame: 1,
              evidence:
                "The bar rests at the front shoulders in the opening frame.",
            },
          ],
        };
        await runVideoJob(
          partialJob,
          async (messages) => {
            if (++calls === 1)
              return {
                role: "assistant",
                content: JSON.stringify(
                  mode === "automatic"
                    ? {
                        attempts: [
                          {
                            startFrame: 1,
                            endFrame: 9,
                            evidence: partialEvidence,
                          },
                        ],
                      }
                    : partialEvidence,
                ),
              };
            assert.match(messages[0].content, /PARTIAL MOVEMENT REVIEW/);
            assert.equal(JSON.parse(messages[1].content).lift, null);
            assert.equal(
              JSON.parse(messages[1].content).reviewScope,
              "visible_phases",
            );
            if (mode === "automatic")
              assert.deepEqual(messages[1].images, ["dense-synthetic"]);
            return { role: "assistant", content: JSON.stringify(coaching) };
          },
          autoProcessor,
          refiner,
        );
        const partial = await getVideo(users[0], partialInput.id);
        assert.equal(calls, 2);
        assert.equal(partial.status, "ready");
        assert.equal(partial.analysis?.identification?.lift, null);
        assert.equal(partial.analysis?.coaching?.scope, "visible_phases");
        assert.equal(partial.analysis?.coaching?.moments[0].evidenceTime, 0.5);
        assert.match(partial.feedback!, /Review of the visible movement/);
        assert.match(partial.feedback!, /Try next/);
        assert.doesNotMatch(partial.feedback!, /withheld lift-specific/);
        await deleteVideo(users[0], partialInput.id);
      }
      // A non-lifting clip still never receives fabricated coaching.
      const emptyInput = { ...automatic, id: crypto.randomUUID() };
      await saveVideo(users[0], emptyInput, source);
      const emptyJob = await claimVideo();
      assert.ok(emptyJob);
      let emptyCalls = 0;
      await runVideoJob(
        emptyJob,
        async () => {
          assert.equal(++emptyCalls, 1);
          return {
            role: "assistant",
            content: JSON.stringify({
              attempts: [
                {
                  startFrame: 1,
                  endFrame: 9,
                  evidence: {
                    visibility: "not_lifting",
                    phases: [],
                    limitation: "No lifting is visible.",
                  },
                },
              ],
            }),
          };
        },
        autoProcessor,
        async () => {
          throw Error("Do not refine a non-lifting clip");
        },
      );
      assert.equal(
        (await getVideo(users[0], emptyInput.id)).analysis?.coaching?.moments
          .length,
        0,
      );
      await deleteVideo(users[0], emptyInput.id);
      // Restart recovery claims an expired lease with a new token.
      const next = { ...input, id: crypto.randomUUID() };
      await saveVideo(users[0], next, source);
      const abandoned = await claimVideo();
      assert.ok(abandoned);
      await pool.query(
        "UPDATE lifting_videos SET lease_until=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
        [users[0], next.id],
      );
      const recovered = await claimVideo();
      assert.ok(recovered);
      assert.notEqual(recovered.token, abandoned.token);
      await runVideoJob(
        recovered,
        async () => {
          await deleteVideo(users[0], next.id);
          return {
            role: "assistant",
            content: "This cannot resurrect the deleted review.",
          };
        },
        processor,
      );
      assert.equal((await listVideos(users[0])).length, 0);
    } finally {
      for (const id of users)
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
