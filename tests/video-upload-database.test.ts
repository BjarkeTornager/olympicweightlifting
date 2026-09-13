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
    const { claimVideo, runVideoJob: executeVideoJob } =
      await import("../lib/video/worker");
    const runVideoJob: typeof executeVideoJob = (...args) => {
      args[6] ??= async (_media, analysis) => ({
        pose: analysis.pose,
        tracking: analysis.tracking,
      });
      return executeVideoJob(...args);
    };
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
      const queuedProgress = (await getVideo(users[0], input.id)).progress;
      assert.equal(queuedProgress?.phase, "queued");
      assert.ok(queuedProgress?.queuedAt);
      assert.equal(queuedProgress?.startedAt, undefined);
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
      const refiner = async (
        _media: Buffer,
        current: VideoAnalysis,
        attempt: import("../lib/video/attempts").VideoAttempt,
      ) => ({
        analysis: {
          ...current,
          identification: attempt.identification,
          pose: {
            version: 2,
            status: "partial" as const,
            reason: "Synthetic exact-frame tracking",
            frames: [{ t: 0.5, points: [{ id: 13, x: 0.4, y: 0.5 }] }],
          },
          segmentation: {
            version: 1 as const,
            model: "sam3.1" as const,
            revision: "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7" as const,
            sourceSha256: "a".repeat(64),
            width: 320,
            height: 480,
            status: "partial" as const,
            reason: "Synthetic outline",
            frames: [
              {
                t: 0.5,
                objects: [
                  {
                    kind: "person" as const,
                    id: "person-1",
                    polygon: [
                      [0.1, 0.1],
                      [0.2, 0.1],
                      [0.2, 0.2],
                    ] as [number, number][],
                  },
                ],
              },
            ],
          },
        },
        frames: ["dense-synthetic"],
      });
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
        refiner,
      );
      assert.equal((await getVideo(users[0], input.id)).status, "failed");
      assert.deepEqual(await videoMedia(users[0], input.id), source);
      const stored = await pool.query(
        "SELECT source FROM lifting_videos WHERE user_id=$1 AND id=$2",
        [users[0], input.id],
      );
      assert.equal(stored.rows[0].source, null);
      await retryVideo(users[0], input.id);
      const retryProgress = (await getVideo(users[0], input.id)).progress;
      assert.equal(retryProgress?.phase, "queued");
      assert.equal(retryProgress?.startedAt, undefined);
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
          else assert.equal(JSON.parse(messages[1].content).lift, undefined);
          return {
            role: "assistant",
            content:
              modelCalls === 1 ? phaseReply : "This is a clear snatch attempt.",
          };
        },
        processor,
        refiner,
      );
      assert.equal(decodes, 1);
      assert.equal(
        modelCalls,
        3,
        "one identification plus two bounded review attempts",
      );
      const guarded = await getVideo(users[0], input.id);
      assert.equal(guarded.status, "queued");
      assert.equal(guarded.feedback, null);
      assert.equal(guarded.error, null);
      assert.equal(guarded.analysis?.segmentation?.frames.length, 1);
      assert.equal(await claimVideo(), null, "recovery waits for its backoff");
      // Exhaust bounded recovery to verify that a persistent fault still has
      // an honest terminal status and an explicit reanalysis remains possible.
      await pool.query(
        "UPDATE lifting_videos SET attempts=2,lease_until=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
        [users[0], input.id],
      );
      const finalRecovery = await claimVideo();
      assert.ok(finalRecovery);
      await runVideoJob(
        finalRecovery,
        async () => ({ role: "assistant", content: "invalid" }),
        async () => {
          throw Error("Must reuse media");
        },
        async () => {
          throw Error("Must reuse GPU work");
        },
      );
      assert.equal((await getVideo(users[0], input.id)).status, "failed");
      assert.equal(
        await claimVideo(),
        null,
        "repeated failure cannot loop forever",
      );
      assert.equal(
        guarded.analysis?.attempts?.[0].identification.lift,
        "Clean & jerk",
      );
      await reanalyseVideo(users[0], input.id, { lift: "Clean & jerk" });
      assert.equal(
        (
          await pool.query(
            "SELECT refinement FROM lifting_videos WHERE user_id=$1 AND id=$2",
            [users[0], input.id],
          )
        ).rows[0].refinement,
        null,
        "explicit reanalysis must discard evidence from the earlier review",
      );
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
              : JSON.stringify({
                  evidence: JSON.parse(phaseReply),
                  coaching: {
                    strength: "The front-rack position is visible.",
                    limitation:
                      "No correction is justified by these synthetic frames.",
                    moments: [],
                  },
                }),
        }),
        processor,
        refiner,
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
        refiner,
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
          version: 2,
          status: "partial",
          reason: "Synthetic",
          frames: [
            { t: 0.5, points: [{ id: 13, x: 0.1, y: 0.2 }] },
            { t: 1, points: [{ id: 13, x: 0.8, y: 0.9 }] },
          ],
        },
      };
      const autoProcessor = async () => ({
        analysis: structuredClone(autoAnalysis),
        media: source,
        frames: ["coarse-synthetic"],
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
            focusFrame: 3,
            evidenceType: "position",
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
                    evidence: {
                      visibility: "sufficient",
                      limitation: "",
                      phases: [
                        {
                          kind: "pull",
                          frame: 1,
                          evidence:
                            "Synthetic incorrect initial pull interpretation.",
                        },
                        {
                          kind: "direct_pull_to_overhead",
                          frame: 6,
                          evidence:
                            "Synthetic incorrect initial direct-overhead interpretation.",
                        },
                        {
                          kind: "overhead_receive",
                          frame: 8,
                          evidence: "Synthetic initial overhead observation.",
                        },
                      ],
                    },
                  },
                ],
              }),
            };
          assert.deepEqual(messages[1].images, ["dense-synthetic"]);
          return {
            role: "assistant",
            content: JSON.stringify({
              evidence: JSON.parse(phaseReply),
              coaching: {
                ...coaching,
                moments: [{ ...coaching.moments[0], frames: [999] }],
              },
            }),
          };
        },
        autoProcessor,
        refiner,
      );
      assert.equal((await getVideo(users[0], automatic.id)).status, "queued");
      assert.equal(
        (await getVideo(users[0], automatic.id)).analysis?.segmentation?.frames
          .length,
        1,
      );
      const savedRefinement = await pool.query(
        "SELECT refinement FROM lifting_videos WHERE user_id=$1 AND id=$2",
        [users[0], automatic.id],
      );
      assert.deepEqual(savedRefinement.rows[0].refinement.frames, [
        "dense-synthetic",
      ]);
      assert.deepEqual(savedRefinement.rows[0].refinement.failure, {
        reason: "coaching_evidence",
        coaching: "frame_range",
      });
      await pool.query(
        "UPDATE lifting_videos SET analysis=analysis-'segmentation', refinement=jsonb_set(refinement,'{version}','1') WHERE user_id=$1 AND id=$2",
        [users[0], automatic.id],
      );
      const legacyCheckpoint = await getVideo(users[0], automatic.id);
      assert.equal(
        legacyCheckpoint.analysis?.segmentation?.frames.length,
        1,
        "previously failed reviews expose their saved outlines without another GPU call",
      );
      assert.equal("checkpoint" in legacyCheckpoint, false);
      assert.equal("failure" in legacyCheckpoint, false);
      await pool.query(
        "UPDATE lifting_videos SET refinement=jsonb_set(refinement,'{version}','5') WHERE user_id=$1 AND id=$2",
        [users[0], automatic.id],
      );
      assert.equal(
        "refinement" in (await getVideo(users[0], automatic.id)),
        false,
        "private evidence checkpoint must not appear in the video response",
      );
      assert.equal(
        (await getVideo(users[0], automatic.id)).analysis?.attempts?.[0]
          .identification.lift,
        "Snatch",
      );
      assert.equal(await claimVideo(), null);
      await pool.query(
        "UPDATE lifting_videos SET lease_until=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
        [users[0], automatic.id],
      );
      const automaticRetry = await claimVideo();
      assert.ok(automaticRetry);
      await runVideoJob(
        automaticRetry,
        async (messages) => {
          autoCalls++;
          assert.deepEqual(messages[1].images, ["dense-synthetic"]);
          return {
            role: "assistant",
            content: JSON.stringify({
              evidence: JSON.parse(phaseReply),
              coaching,
            }),
          };
        },
        async () => {
          throw Error("Must reuse saved media");
        },
        async () => {
          throw Error("Must reuse checkpointed frame extraction and GPU work");
        },
        undefined,
        undefined,
        async () => {
          throw Error("Must reuse checkpointed overlay recovery");
        },
      );
      const completed = await getVideo(users[0], automatic.id);
      assert.equal(completed.status, "ready");
      assert.equal(autoCalls, 4);
      assert.equal(
        (
          await pool.query(
            "SELECT refinement FROM lifting_videos WHERE user_id=$1 AND id=$2",
            [users[0], automatic.id],
          )
        ).rows[0].refinement,
        null,
      );
      assert.equal(completed.analysis?.coaching?.moments[0].evidenceTime, 0.5);
      assert.deepEqual(
        completed.analysis?.coaching?.moments[0].evidenceTimes,
        [0.5],
      );
      assert.equal(completed.analysis?.reviewVersion, 2);
      assert.equal(completed.analysis?.identification?.lift, "Clean & jerk");
      assert.equal(completed.analysis?.pose?.version, 2);
      assert.deepEqual(
        completed.analysis?.pose?.frames.find((f) => f.t === 0.5)?.points,
        [{ id: 13, x: 0.4, y: 0.5 }],
      );
      assert.deepEqual(
        completed.analysis?.pose?.frames.find((f) => f.t === 1)?.points,
        [],
      );
      assert.deepEqual(
        (await listVideos(users[0]))[0].analysis?.pose?.frames,
        [],
      );
      assert.deepEqual(
        (await listVideos(users[0]))[0].analysis?.segmentation?.frames,
        [],
      );
      assert.equal(completed.analysis?.segmentation?.frames.length, 1);
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
            assert.equal(JSON.parse(messages[1].content).lift, undefined);
            assert.equal(
              JSON.parse(messages[1].content).identification,
              undefined,
            );
            if (mode === "automatic")
              assert.deepEqual(messages[1].images, ["dense-synthetic"]);
            return {
              role: "assistant",
              content: JSON.stringify({ evidence: partialEvidence, coaching }),
            };
          },
          autoProcessor,
          refiner,
          undefined,
          undefined,
          async (_media, detailed) => ({
            pose: {
              ...detailed.pose!,
              frames: [
                ...detailed.pose!.frames,
                { t: 0.625, points: [{ id: 13, x: 0.42, y: 0.51 }] },
              ].sort((a, b) => a.t - b.t),
            },
            tracking: {
              ...detailed.tracking,
              source: "automatic_plate",
              status: "partial",
              points: [0.5, 0.55, 0.6].map((t) => ({
                t,
                x: 0.4,
                y: 0.7,
                score: 0.85,
              })),
              coverage: 0.3,
            },
          }),
        );
        const partial = await getVideo(users[0], partialInput.id);
        assert.equal(calls, 2);
        assert.equal(partial.status, "ready");
        assert.equal(partial.analysis?.overlayVersion, 1);
        assert.equal(partial.analysis?.tracking.source, "automatic_plate");
        assert.equal(partial.analysis?.tracking.points.length, 3);
        assert(
          partial.analysis?.tracking.points.every(
            (p) => p.segment === "attempt-1",
          ),
        );
        assert.deepEqual(
          partial.analysis?.pose?.frames.find((f) => f.t === 0.625)?.points,
          [{ id: 13, x: 0.42, y: 0.51 }],
        );
        assert.equal(partial.analysis?.identification?.lift, null);
        assert.equal(partial.analysis?.coaching?.scope, "visible_phases");
        assert.equal(partial.analysis?.coaching?.moments[0].evidenceTime, 0.5);
        assert.match(partial.feedback!, /Review of the visible movement/);
        assert.match(partial.feedback!, /Try next/);
        assert.doesNotMatch(partial.feedback!, /withheld lift-specific/);
        await deleteVideo(users[0], partialInput.id);
      }
      // A slow GPU is durable waiting, not repeated failed uploads. Each call
      // below starts a new worker invocation and must use the private receipt.
      const { SegmentationPending } = await import("../lib/video/sam3");
      const queuedInput = { ...input, id: crypto.randomUUID() };
      await saveVideo(users[0], queuedInput, source);
      let queueModels = 0,
        queueRefines = 0,
        queueSubmits = 0,
        queueReads = 0;
      let gpuReady = false;
      const queuedModel: typeof import("../lib/agent/provider").callModel =
        async () => ({
          role: "assistant",
          content:
            ++queueModels === 1
              ? phaseReply
              : JSON.stringify({
                  evidence: JSON.parse(phaseReply),
                  coaching: {
                    strength: "The front rack receiving position is visible.",
                    limitation: "",
                    moments: [],
                  },
                }),
        });
      const queuedRefiner: typeof import("../lib/video/processor").refineVideo =
        async (_media, current) => {
          queueRefines++;
          return {
            analysis: { ...current, segmentation: undefined },
            frames: ["synthetic-dense-queue-evidence"],
          };
        };
      const queuedSegmenter: typeof import("../lib/video/sam3").segmentVideo =
        async (
          _media,
          _analysis,
          _signal,
          _config,
          _request,
          _budget,
          resume,
        ) => {
          assert.ok(resume);
          if (!resume.job) {
            queueSubmits++;
            await resume.saveJob({
              requestId: crypto.randomUUID(),
              receipt: "private-fixture-job",
              binding: "a".repeat(64),
              expiresAt: Date.now() + 900000,
            });
          } else {
            queueReads++;
            assert.equal(resume.job.receipt, "private-fixture-job");
          }
          if (!gpuReady) throw new SegmentationPending();
          return (
            await refiner(source, analysis, {
              id: "attempt-1",
              start: 0,
              end: 2,
              identification: JSON.parse(phaseReply),
            })
          ).analysis.segmentation;
        };
      for (let i = 0; i < 5; i++) {
        const waitingJob = await claimVideo();
        assert.ok(waitingJob);
        await runVideoJob(
          waitingJob,
          queuedModel,
          processor,
          queuedRefiner,
          queuedSegmenter,
        );
        const visible = await getVideo(users[0], queuedInput.id);
        assert.equal(visible.status, "queued");
        assert.match(visible.stage, /continuing automatically/);
        assert.equal(visible.progress?.phase, "tracking");
        assert.ok(visible.progress?.startedAt);
        assert.equal(visible.progress?.completedAt, undefined);
        assert.doesNotMatch(
          JSON.stringify(visible),
          /private-fixture-job|sam3Job|receipt/,
        );
        assert.doesNotMatch(
          JSON.stringify(await listVideos(users[0])),
          /private-fixture-job|sam3Job|receipt/,
        );
        const stored = await pool.query(
          "SELECT attempts,refinement FROM lifting_videos WHERE user_id=$1 AND id=$2",
          [users[0], queuedInput.id],
        );
        assert.equal(stored.rows[0].attempts, 0);
        assert.equal(
          stored.rows[0].refinement.sam3Job.receipt,
          "private-fixture-job",
        );
        await pool.query(
          "UPDATE lifting_videos SET lease_until=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
          [users[0], queuedInput.id],
        );
      }
      gpuReady = true;
      const readyJob = await claimVideo();
      assert.ok(readyJob);
      await runVideoJob(
        readyJob,
        queuedModel,
        processor,
        queuedRefiner,
        queuedSegmenter,
      );
      assert.equal((await getVideo(users[0], queuedInput.id)).status, "ready");
      assert.equal(queueSubmits, 1);
      assert.equal(queueReads, 5);
      assert.equal(queueModels, 2);
      assert.equal(queueRefines, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT refinement FROM lifting_videos WHERE user_id=$1 AND id=$2",
            [users[0], queuedInput.id],
          )
        ).rows[0].refinement,
        null,
      );
      await pool.query(
        "UPDATE lifting_videos SET analysis=jsonb_set(analysis,'{segmentation,failure}','\"deadline\"') WHERE user_id=$1 AND id=$2",
        [users[0], queuedInput.id],
      );
      assert.equal(
        (await getVideo(users[0], queuedInput.id)).stage,
        "Partial review · outlines unavailable",
      );
      await deleteVideo(users[0], queuedInput.id);

      // Body reconstruction waits durably in its own checkpoint. Its images
      // are owner-only details, never journal/list payloads or queue receipts.
      const priorBodyUrl = process.env.VIDEO_BODY_URL,
        priorPilot = process.env.VIDEO_SAM3_PILOT_EMAIL;
      process.env.VIDEO_BODY_URL = "https://synthetic-body.example.test/body";
      process.env.VIDEO_SAM3_PILOT_EMAIL = `${users[0]}@example.test`;
      const bodyInput = { ...input, id: crypto.randomUUID() };
      try {
        await saveVideo(users[0], bodyInput, source);
        queueModels = 0;
        let bodyCalls = 0;
        const bodyReconstructor: typeof import("../lib/video/body-server").reconstructBody =
          async (
            _media,
            _analysis,
            _signal,
            config,
            _request,
            _budget,
            resume,
          ) => {
            assert.equal(config?.endpoint, process.env.VIDEO_BODY_URL);
            assert.ok(
              _analysis.coaching,
              "feedback is established before computing a suggested pose",
            );
            assert.ok(resume);
            if (++bodyCalls === 1) {
              await resume.saveJob({
                requestId: crypto.randomUUID(),
                receipt: "private-body-receipt",
                binding: "b".repeat(64),
                expiresAt: Date.now() + 900000,
              });
              throw new SegmentationPending();
            }
            assert.equal(resume.job?.receipt, "private-body-receipt");
            return {
              version: 1,
              model: "sam-3d-body",
              revision: "11aaa346c7204874a1cbafe3d39a979080b2c55a",
              sourceSha256: "a".repeat(64),
              width: 320,
              height: 480,
              status: "tracked",
              reason: "Synthetic body",
              frames: [
                { t: 0.5, image: "data:image/png;base64,iVBORw0KGgoAAA" },
              ],
              motion: {
                version: 1,
                status: "available",
                reason: "Synthetic",
                clips: [
                  {
                    id: "synthetic",
                    start: 0.5,
                    end: 1,
                    frames: [
                      { t: 0.5, image: "data:image/png;base64,iVBORw0KGgoAAA" },
                    ],
                  },
                ],
              },
            };
          };
        const first = await claimVideo();
        assert.ok(first);
        await runVideoJob(
          first,
          queuedModel,
          processor,
          refiner,
          undefined,
          bodyReconstructor,
        );
        const waiting = await getVideo(users[0], bodyInput.id);
        assert.equal(waiting.status, "queued");
        assert.match(waiting.stage, /3D body overlay/);
        assert.equal(waiting.progress?.phase, "body");
        assert.doesNotMatch(
          JSON.stringify(waiting),
          /private-body-receipt|bodyJob/,
        );
        await pool.query(
          "UPDATE lifting_videos SET lease_until=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
          [users[0], bodyInput.id],
        );
        const second = await claimVideo();
        assert.ok(second);
        const modelsBeforeResume = queueModels;
        await runVideoJob(
          second,
          queuedModel,
          processor,
          refiner,
          undefined,
          bodyReconstructor,
        );
        const bodyReview = await getVideo(users[0], bodyInput.id);
        assert.equal(bodyReview.status, "ready");
        assert.equal(bodyReview.progress?.phase, "ready");
        assert.equal(
          bodyReview.progress?.startedAt,
          waiting.progress?.startedAt,
          "GPU resumes preserve the real start time",
        );
        assert.ok(bodyReview.progress?.completedAt);
        assert.equal(bodyCalls, 2);
        assert.equal(
          queueModels,
          modelsBeforeResume,
          "queued correction resumes without regenerating Coach's advice",
        );
        assert.equal(bodyReview.analysis?.body?.frames.length, 1);
        assert.deepEqual(
          (await listVideos(users[0])).find((v) => v.id === bodyInput.id)
            ?.analysis?.body?.frames,
          [],
        );
        assert.deepEqual(
          (await listVideos(users[0])).find((v) => v.id === bodyInput.id)
            ?.analysis?.body?.motion?.clips,
          [],
        );
        await assert.rejects(getVideo(users[1], bodyInput.id), /not found/);
        await deleteVideo(users[0], bodyInput.id);
        await assert.rejects(getVideo(users[0], bodyInput.id), /not found/);
      } finally {
        if (priorBodyUrl === undefined) delete process.env.VIDEO_BODY_URL;
        else process.env.VIDEO_BODY_URL = priorBodyUrl;
        if (priorPilot === undefined) delete process.env.VIDEO_SAM3_PILOT_EMAIL;
        else process.env.VIDEO_SAM3_PILOT_EMAIL = priorPilot;
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
        refiner,
      );
      assert.equal((await listVideos(users[0])).length, 0);
      // The cross-upload focus uses the same owner-scoped read as the worker.
      const { correctionReview } = await import("./fixtures/correction");
      const { previousVideoFocus } = await import("../lib/video/focus");
      const prior = correctionReview();
      const ownId = crypto.randomUUID(),
        otherId = crypto.randomUUID();
      for (const [owner, id] of [
        [users[0], ownId],
        [users[1], otherId],
      ]) {
        await saveVideo(owner, { ...input, id }, source);
        const coaching = structuredClone(prior.analysis!);
        coaching.coaching!.moments[0].title =
          owner === users[0] ? "My prior focus" : "Other account private focus";
        await pool.query(
          "UPDATE lifting_videos SET status='ready',analysis=$3,created_at=$4 WHERE user_id=$1 AND id=$2",
          [owner, id, JSON.stringify(coaching), prior.createdAt],
        );
      }
      const focus = previousVideoFocus(await listVideos(users[0]), {
        id: crypto.randomUUID(),
        lift: "Jerk",
        createdAt: "2026-09-13T12:00:00Z",
      });
      assert.equal(focus?.reviewId, ownId);
      assert.equal(focus?.title, "My prior focus");
      assert.equal(JSON.stringify(focus).includes("Other account"), false);
    } finally {
      for (const id of users)
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
