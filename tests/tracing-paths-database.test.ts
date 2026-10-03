import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import sharp from "sharp";
import type { VideoAnalysis } from "../lib/video/types";
config({ path: ".env.local", quiet: true });

// Photo tagging, a voice call and a video review, traced end to end: the
// provider, Gemini and the GPU are mocked at fetch or replaced, spans are
// read back from an in-memory exporter. A canary in the photo's label, the
// athlete's name, the transcript, a connection report's reason and the
// review's feedback, and what the photo shows, must appear nowhere.
const CANARY = "CANARY-7f3a";

test(
  "photo tagging, a voice call and a video review are each traced, grouped by their own codes and free of content",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      TRACING: "metadata",
      MLFLOW_TRACKING_URI: "http://127.0.0.1:5999",
      MLFLOW_EXPERIMENT_ID: "7",
      TRACE_USER_SECRET: "test-only-secret",
      AGENT_PROVIDER: "openrouter",
      AGENT_MODEL: "openai/gpt-5.6-luna",
      OPENROUTER_API_KEY: "test-only-not-a-key",
      GEMINI_API_KEY: "test-only-not-a-key",
    });
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
    delete process.env.TRACE_CONTENT;
    delete process.env.TRACE_SAMPLE_RATE;
    delete process.env.ELEVENLABS_API_KEY;
    const { createHmac, randomBytes, randomUUID } = await import("node:crypto");
    const { getPool } = await import("../lib/db");
    const { getAuth } = await import("../lib/auth");
    const { MIN_IOS_BUILD } = await import("../lib/native-client");
    const { saveUserImage, tagUserImage } = await import("../lib/user-images");
    const { saveVoiceTranscript, tidyVoiceCall } =
      await import("../lib/conversation-memory");
    const { saveVideo } = await import("../lib/video/store");
    const { runVideoJob } = await import("../lib/video/worker");
    const { POST: startCall } = await import("../app/api/voice/session/route");
    const { POST: voiceAction } = await import("../app/api/voice/action/route");
    const { POST: voiceEvent } = await import("../app/api/voice/event/route");
    const { memoryExporterForTests } = await import("../lib/tracing/provider");
    const { allowed } = await import("../lib/tracing/attributes");
    const { sessionCode, userCode } = await import("../lib/tracing/ids");
    const memory = await memoryExporterForTests();
    const pool = getPool(),
      origin = new URL(process.env.BETTER_AUTH_URL).origin,
      user = crypto.randomUUID(),
      email = `tracing-${user}@example.test`;
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,$2,$3,true)",
      [user, `${CANARY} Jensen`, email],
    );
    // With an owner configured (as in CI) only invited emails sign in and
    // only invited accounts' videos are reviewed.
    await pool.query(
      "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
      [crypto.randomUUID(), email, user],
    );
    const raw = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO auth_sessions(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [crypto.randomUUID(), raw, user],
    );
    const secret = (await getAuth().$context).secret;
    // As the iPhone sends them.
    const headers = {
      Authorization: `Bearer ${raw}.${createHmac("sha256", secret).update(raw).digest("base64")}`,
      Origin: origin,
      "X-Journal-Account": user,
      "X-Client": `ios/1.0/${MIN_IOS_BUILD}`,
      "X-Voice-Client": "4",
      "Content-Type": "application/json",
    };
    const post = (
      route: (request: Request) => Promise<Response>,
      path: string,
      body: unknown,
    ) =>
      route(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );

    const phases = {
      visibility: "sufficient",
      limitation: "",
      phases: [
        { kind: "pull", frame: 1, evidence: "The bar rises from the knee." },
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
    };
    const usage = {
      prompt_tokens: 1800,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      cost: 0.0007,
    };
    const reply = (message: Record<string, unknown>) =>
      Response.json({
        model: "openai/gpt-5.6-luna",
        usage,
        choices: [{ finish_reason: "stop", message }],
      });
    const fetch = mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        if (url.startsWith("https://generativelanguage.googleapis.com/"))
          return Response.json({ name: "auth_tokens/test-only" });
        assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
        const body = JSON.parse(String(init.body));
        const system = String(body.messages[0].content);
        if (system.startsWith("You sort private journal images"))
          return reply({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "classify_image",
                  arguments: JSON.stringify({
                    category: "sleep",
                    confidence: "high",
                    tags: ["oura", "sleep report"],
                  }),
                },
              },
            ],
          });
        if (system.startsWith("You tidy")) {
          const sent = JSON.parse(body.messages[1].content);
          return reply({
            role: "assistant",
            content: JSON.stringify({
              lines: sent.lines.map((l: { text: string }) => `${l.text}.`),
            }),
          });
        }
        if (system.startsWith("Inspect a sequence of sampled video frames"))
          return reply({ role: "assistant", content: JSON.stringify(phases) });
        if (system.startsWith("You are reviewing an Olympic lifting clip"))
          return reply({
            role: "assistant",
            content: JSON.stringify({
              evidence: phases,
              coaching: {
                strength: `Your rack is solid ${CANARY}.`,
                limitation: "No correction is justified by these frames.",
                moments: [],
              },
            }),
          });
        throw Error(`Unexpected model request: ${system.slice(0, 40)}`);
      },
    );
    t.after(async () => {
      fetch.mock.restore();
      await memory.stop();
      await pool.query("DELETE FROM journal_invitations WHERE email=$1", [
        email,
      ]);
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
      await pool.end();
    });

    const spans = () => memory.spans();
    const roots = (name: string) =>
      spans().filter((s) => s.name === name && !s.parentSpanId);
    const childrenOf = (span: { spanId: string }) =>
      spans().filter((s) => s.parentSpanId === span.spanId);
    const code = userCode("test-only-secret", user);

    // Photo tagging: an upload tagged before answering, one tagged after,
    // and the athlete's Retag, each its own trace.
    const pixels = (
      await sharp({
        create: { width: 48, height: 64, channels: 3, background: "#203040" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const upload = (tagInBackground: boolean) =>
      saveUserImage(user, {
        id: crypto.randomUUID(),
        label: `${CANARY} breakfast`,
        date: "2026-10-03",
        image: pixels,
        autoTag: true,
        ...(tagInBackground ? { tagInBackground } : {}),
      });
    const tagged = await upload(false);
    assert.equal(tagged.category, "sleep");
    await upload(true);
    for (let i = 0; i < 200 && roots("image_tag").length < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await tagUserImage(user, tagged.id, tagged.version);
    const tags = roots("image_tag");
    assert.deepEqual(tags.map((s) => s.attributes["lift.trigger"]).sort(), [
      "retag",
      "upload",
      "upload_background",
    ]);
    for (const root of tags) {
      assert.equal(root.attributes["user.id"], code);
      assert.equal(root.attributes["lift.ok"], true);
      assert.equal(root.attributes["lift.tag_count"], 2);
      assert.equal(root.attributes["lift.confident"], true);
      const [chat] = childrenOf(root);
      assert.equal(chat.name, "chat");
      assert.equal(chat.attributes["lift.image_count"], 1);
      assert.equal(chat.attributes["gen_ai.usage.input_tokens"], 1800);
      assert.equal(chat.attributes["lift.cost_usd"], 0.0007);
    }
    const sessionOf = (trigger: string) =>
      tags.find((s) => s.attributes["lift.trigger"] === trigger)!.attributes[
        "session.id"
      ];
    assert.equal(
      sessionOf("upload"),
      sessionOf("retag"),
      "one photo's runs are grouped",
    );
    assert.notEqual(sessionOf("upload"), sessionOf("upload_background"));

    // A voice call: setup, a tool, a connection report and the tidy share
    // the call's code. An app that sends no call id is still traced.
    const callId = crypto.randomUUID();
    const started = await post(startCall, "/api/voice/session", {
      timezone: "Europe/Copenhagen",
      callId,
    });
    assert.equal(started.status, 200);
    const action = await post(voiceAction, "/api/voice/action", {
      id: crypto.randomUUID(),
      name: "read_journal",
      args: { from: "2026-10-03", to: "2026-10-03" },
      timezone: "Europe/Copenhagen",
      callId,
    });
    assert.equal((await action.json()).ok, true);
    for (const body of [
      { event: "socket_closed", code: 1006, reason: `lost ${CANARY}`, callId },
      { event: "reconnected", attempts: 2, resumed: 1 },
    ]) {
      const logged = await post(voiceEvent, "/api/voice/event", body);
      assert.equal((await logged.json()).logged, true);
    }
    await saveVoiceTranscript(user, {
      id: callId,
      purpose: "checkin",
      entries: [
        { role: "you", text: `I had ${CANARY} oats` },
        { role: "coach", text: "Logged your oats" },
      ],
    });
    await tidyVoiceCall(user, callId);
    const call = sessionCode("test-only-secret", `voice:${user}:${callId}`);
    const [setup] = roots("voice_setup");
    assert.equal(setup.attributes["session.id"], call);
    assert.equal(setup.attributes["lift.provider"], "google");
    assert.equal(setup.attributes["lift.purpose"], "checkin");
    assert.equal(setup.attributes["lift.resumed"], false);
    assert.equal(setup.attributes["lift.ok"], true);
    assert.ok(Number(setup.attributes["lift.instruction_chars"]) > 1000);
    assert.deepEqual(
      childrenOf(setup)
        .map((s) => s.name)
        .sort(),
      ["context", "mint_token"],
    );
    const [tool] = roots("voice_tool");
    assert.equal(tool.attributes["session.id"], call);
    assert.equal(tool.attributes["gen_ai.operation.name"], "execute_tool");
    assert.equal(tool.attributes["gen_ai.tool.name"], "read_journal");
    assert.equal(tool.attributes["lift.ok"], true);
    assert.equal(tool.attributes["lift.saved"], false);
    const sockets = roots("voice_socket");
    const closed = sockets.find(
      (s) => s.attributes["lift.socket_event"] === "socket_closed",
    )!;
    assert.equal(closed.attributes["session.id"], call);
    assert.equal(closed.attributes["lift.close_code"], 1006);
    const reconnected = sockets.find(
      (s) => s.attributes["lift.socket_event"] === "reconnected",
    )!;
    assert.equal(reconnected.attributes["session.id"], undefined);
    assert.equal(reconnected.attributes["lift.reconnect_attempts"], 2);
    assert.equal(reconnected.attributes["lift.resumed"], true);
    const [tidy] = roots("voice_tidy");
    assert.equal(tidy.attributes["session.id"], call);
    assert.equal(tidy.attributes["lift.trigger"], "final");
    assert.equal(tidy.attributes["lift.lines"], 2);
    assert.equal(tidy.attributes["lift.chunks"], 1);
    assert.equal(tidy.attributes["lift.ok"], true);
    assert.deepEqual(
      childrenOf(tidy).map((s) => s.attributes["gen_ai.usage.input_tokens"]),
      [1800],
    );

    // A video review: one attempt, its stages and model calls.
    const video = {
      id: crypto.randomUUID(),
      lift: "Clean & jerk",
      date: "2026-10-03",
      start: 0,
      end: 2,
    };
    const source = await readFile("tests/fixtures/lifting-motion.mp4");
    await saveVideo(user, video, source);
    // Leased directly, not claimed: other tests share the queue.
    const token = randomUUID();
    await pool.query(
      "UPDATE lifting_videos SET status='processing',lease=$3,lease_until=now()+interval '11 minutes',attempts=attempts+1 WHERE user_id=$1 AND id=$2",
      [user, video.id, token],
    );
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
    await runVideoJob(
      { user_id: user, id: video.id, token },
      undefined,
      async () => ({
        analysis,
        frames: ["c3ludGhldGljLWZyYW1l"],
        media: source,
      }),
      async (_media, current, attempt) => ({
        analysis: { ...current, identification: attempt.identification },
        frames: ["c3ludGhldGljLWRlbnNl"],
      }),
      async () => undefined,
      async () => undefined,
      async (_media, current) => ({
        pose: current.pose,
        tracking: current.tracking,
      }),
    );
    const { rows } = await pool.query(
      "SELECT status FROM lifting_videos WHERE user_id=$1 AND id=$2",
      [user, video.id],
    );
    assert.equal(rows[0].status, "ready");
    const [job] = roots("video_job");
    assert.equal(job.attributes["user.id"], code);
    assert.equal(
      job.attributes["session.id"],
      sessionCode("test-only-secret", `video:${user}:${video.id}`),
    );
    assert.equal(job.attributes["lift.outcome"], "done");
    assert.equal(job.attributes["lift.attempt"], 1);
    assert.equal(job.attributes["lift.phase_reached"], "ready");
    assert.equal(job.attributes["lift.frames"], 1);
    assert.equal(job.attributes["lift.clip_attempts"], 1);
    assert.deepEqual(
      childrenOf(job)
        .map((s) => s.name)
        .sort(),
      [
        "identify",
        "overlay_recovery",
        "process_video",
        "refine",
        "review",
        "sam3",
      ],
    );
    for (const step of ["identify", "review"]) {
      const [span] = childrenOf(job).filter((s) => s.name === step);
      const [chat] = childrenOf(span);
      assert.equal(chat.name, "chat");
      assert.equal(chat.attributes["gen_ai.usage.output_tokens"], 40);
    }
    assert.equal(
      childrenOf(job).find((s) => s.name === "review")!.attributes[
        "lift.valid"
      ],
      true,
    );

    // Nothing anywhere but allowed metadata: no label, name, transcript,
    // reason, feedback, frame or what the photo shows.
    for (const span of spans()) {
      assert.equal(allowed(span.attributes).dropped, 0, span.name);
      assert.equal(span.attributes["lift.dropped_attrs"], undefined);
    }
    const sent = JSON.stringify(spans());
    for (const secret of [
      CANARY,
      user,
      "breakfast",
      "sleep",
      "oura",
      "oats",
      "Jensen",
      "rack is solid",
      "c3ludGhldGlj",
      "auth_tokens/test-only",
    ])
      assert.ok(!sent.includes(secret), `${secret} is not in a trace`);
  },
);
