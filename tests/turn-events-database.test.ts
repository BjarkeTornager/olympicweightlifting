import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "dotenv";
import type { ModelResponse } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

const skip = !process.env.TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

type Frame = { id?: number; data: string };
// An SSE body's frames, keep-alive comments left out.
const framesOf = (text: string): Frame[] =>
  text
    .split("\n\n")
    .filter((frame) => frame && !frame.startsWith(":"))
    .map((frame) => {
      const id = /^id: (\d+)$/m.exec(frame)?.[1];
      return {
        ...(id ? { id: Number(id) } : {}),
        data: /^data: (.*)$/m.exec(frame)![1],
      };
    });
const typeOf = (frame: Frame) => JSON.parse(frame.data).type as string;
// Reads a stream until `enough` holds for the frames so far, then closes the
// connection, as a phone losing signal does.
async function readUntil(
  response: Response,
  enough: (frames: Frame[]) => boolean,
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return framesOf(text);
    text += decoder.decode(value, { stream: true });
    const frames = framesOf(text.slice(0, text.lastIndexOf("\n\n") + 2));
    if (enough(frames)) {
      await reader.cancel();
      return frames;
    }
  }
}
// Reads a stream one frame at a time.
function frameReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const queue: Frame[] = [];
  let buffer = "";
  return async (): Promise<Frame | undefined> => {
    while (!queue.length) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += decoder.decode(value, { stream: true });
      const end = buffer.lastIndexOf("\n\n");
      if (end < 0) continue;
      queue.push(...framesOf(buffer.slice(0, end + 2)));
      buffer = buffer.slice(end + 2);
    }
    return queue.shift();
  };
}
// The reply's pieces as one event per message, as the merged rows are.
function mergeText(lines: string[]) {
  const merged: string[] = [];
  let text: { messageId: string; delta: string } | undefined;
  for (const line of lines) {
    const event = JSON.parse(line);
    if (
      event.type === "TEXT_MESSAGE_CONTENT" &&
      text &&
      text.messageId === event.messageId
    ) {
      text = { ...text, delta: text.delta + event.delta };
      merged[merged.length - 1] = JSON.stringify(text);
    } else {
      text = event.type === "TEXT_MESSAGE_CONTENT" ? event : undefined;
      merged.push(line);
    }
  }
  return merged;
}

async function setup() {
  assert.ok(
    new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    "Use a disposable database",
  );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  const { createHmac, randomBytes } = await import("node:crypto");
  const { getPool } = await import("../lib/db");
  const { getAuth } = await import("../lib/auth");
  const { MIN_IOS_BUILD } = await import("../lib/native-client");
  const pool = getPool();
  const id = crypto.randomUUID(),
    email = `turn-events-${id}@example.test`;
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA',$2,true)",
    [id, email],
  );
  // With an owner configured (as in CI) only invited emails sign in; the
  // invitation goes with the synthetic account.
  await pool.query(
    "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
    [crypto.randomUUID(), email, id],
  );
  const raw = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO auth_sessions(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [crypto.randomUUID(), raw, id],
  );
  const secret = (await getAuth().$context).secret;
  const token = `${raw}.${createHmac("sha256", secret).update(raw).digest("base64")}`;
  // As the iPhone sends them.
  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: new URL(process.env.BETTER_AUTH_URL).origin,
    "X-Journal-Account": id,
    "X-Client": `ios/1.0/${MIN_IOS_BUILD}`,
  };
  const cleanUp = async () => {
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await pool.query("DELETE FROM journal_invitations WHERE email=$1", [email]);
    await pool.query("DELETE FROM request_limits WHERE key=$1", [
      `agent:${id}`,
    ]);
  };
  const rows = async (turnId: string) =>
    (
      await pool.query<{ seq: number; attempt: number; event: string }>(
        "SELECT seq, attempt, event::text AS event FROM agent_turn_events WHERE turn_id=$1 ORDER BY seq",
        [turnId],
      )
    ).rows;
  return { pool, user: id, headers, cleanUp, rows };
}

const input = (id = crypto.randomUUID()) => ({
  id,
  message: "How did I sleep this week?",
  revision: 0,
  timezone: "Europe/Copenhagen",
});

test(
  "with COACH_TURN_EVENTS off a Coach run is today's: nothing written, nothing listening, no ids",
  { skip },
  async (t) => {
    const { headers, cleanUp, rows } = await setup();
    t.after(cleanUp);
    // An Ollama stand-in, so the route runs its real model call locally.
    const ollama = createServer(async (request, response) => {
      for await (const chunk of request) void chunk;
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      for (const content of ["Seven hours ", "most nights."]) {
        response.write(
          JSON.stringify({ message: { role: "assistant", content } }) + "\n",
        );
        await sleep(20);
      }
      response.end(
        JSON.stringify({
          message: { role: "assistant", content: "" },
          done: true,
          done_reason: "stop",
        }) + "\n",
      );
    });
    await new Promise<void>((resolve) => ollama.listen(0, resolve));
    t.after(() => ollama.close());
    const saved = Object.fromEntries(
      [
        "AGENT_PROVIDER",
        "OLLAMA_BASE_URL",
        "OLLAMA_MODEL",
        "COACH_TURN_EVENTS",
      ].map((key) => [key, process.env[key]]),
    );
    t.after(() => {
      for (const [key, value] of Object.entries(saved))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
    Object.assign(process.env, {
      AGENT_PROVIDER: "ollama",
      OLLAMA_BASE_URL: `http://127.0.0.1:${(ollama.address() as AddressInfo).port}/api`,
      OLLAMA_MODEL: "test-stand-in",
    });
    delete process.env.COACH_TURN_EVENTS;
    const { POST, GET } = await import("../app/api/agent/run/route");
    const turn = input();
    const response = await POST(
      new Request(`${headers.Origin}/api/agent/run`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Coach-Background": "1",
        },
        body: JSON.stringify({
          threadId: "coach",
          runId: turn.id,
          state: {},
          tools: [],
          context: [],
          messages: [{ id: turn.id, role: "user", content: turn.message }],
          forwardedProps: { revision: 0, timezone: turn.timezone },
        }),
      }),
    );
    assert.equal(response.status, 200);
    const frames = framesOf(await response.text());
    assert.deepEqual(frames.map(typeOf).slice(-1), ["RUN_FINISHED"]);
    assert.equal(
      JSON.parse(frames.at(-1)!.data).result.reply,
      "Seven hours most nights.",
    );
    // Every piece as it came, with no SSE ids.
    assert.equal(
      frames.filter((f) => typeOf(f) === "TEXT_MESSAGE_CONTENT").length,
      2,
    );
    assert.ok(frames.every((f) => f.id === undefined));
    assert.deepEqual(await rows(turn.id), []);
    // No writer, reader or LISTEN connection was ever made.
    assert.equal(
      (globalThis as { coachTurnEvents?: unknown }).coachTurnEvents,
      undefined,
    );
    const resume = await GET(
      new Request(`${headers.Origin}/api/agent/run?turnId=${turn.id}`, {
        headers,
      }),
    );
    assert.equal(resume.status, 404);
  },
);

test(
  "a turn's events land in order and read back as the in-memory stream sends them",
  { skip },
  async (t) => {
    const { user, cleanUp, rows } = await setup();
    t.after(cleanUp);
    const { runTurn } = await import("../lib/agent/engine");
    const { coachStream, storedCoachStream } =
      await import("../lib/agent/stream");
    const { stopTurnEventListener } = await import("../lib/agent/turn-events");
    t.after(stopTurnEventListener);
    const pieces = [
      "Seven ",
      "hours ",
      "a night, ",
      "and ",
      "your ",
      "sleep ",
      "looks ",
      "steady.",
    ];
    const model = async (
      messages: { role: string }[],
      _tools: unknown,
      _signal: AbortSignal,
      onText?: (delta: string) => void,
    ): Promise<ModelResponse> => {
      if (!messages.some((m) => m.role === "tool"))
        return {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "find_sessions", arguments: {} } }],
        };
      for (const piece of pieces) {
        onText?.(piece);
        await sleep(15);
      }
      return { role: "assistant", content: pieces.join("") };
    };
    const inMemory = input(),
      stored = input();
    const before = await coachStream(
      new Request("http://localhost"),
      "coach",
      inMemory.id,
      (emit, signal) => runTurn(user, inMemory, model, { emit, signal }),
    ).text();
    const response = storedCoachStream(
      new Request("http://localhost"),
      "coach",
      stored.id,
      (emit, signal, onAttempt) =>
        runTurn(user, stored, model, { emit, signal, onAttempt }),
      { key: `${user}:${stored.id}` },
    );
    assert.match(response.headers.get("content-type")!, /text\/event-stream/);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    const after = framesOf(await response.text());

    // RUN_STARTED as today, then each event from the table with its id.
    assert.equal(after[0].id, undefined);
    assert.equal(typeOf(after[0]), "RUN_STARTED");
    const saved = await rows(stored.id);
    assert.deepEqual(
      after.slice(1).map((f) => [f.id, f.data]),
      saved.map((r) => [r.seq, r.event]),
    );
    assert.deepEqual(
      saved.map((r) => r.seq),
      saved.map((_, i) => i + 1),
    );
    assert.ok(saved.every((r) => r.attempt === 1));
    assert.equal(typeOf(after.at(-1)!), "RUN_FINISHED");
    // The reply's eight pieces went in fewer rows.
    const pieceRows = after.filter((f) => typeOf(f) === "TEXT_MESSAGE_CONTENT");
    assert.ok(
      pieceRows.length >= 1 && pieceRows.length < pieces.length,
      `${pieceRows.length} rows`,
    );

    // Byte for byte the in-memory stream's events, once each message's
    // pieces are put together and the turn ids are the same.
    const lines = (frames: Frame[], id: string) =>
      mergeText(frames.map((f) => f.data.replaceAll(id, "TURN")));
    assert.deepEqual(
      lines(after, stored.id),
      lines(framesOf(before), inMemory.id),
    );
    assert.equal(JSON.parse(after.at(-1)!.data).result.reply, pieces.join(""));
  },
);

test(
  "a dropped connection doesn't stop a background turn, and reconnecting with ?after reads on without gaps or repeats",
  { skip },
  async (t) => {
    const { pool, user, headers, cleanUp, rows } = await setup();
    t.after(cleanUp);
    process.env.COACH_TURN_EVENTS = "1";
    t.after(() => delete process.env.COACH_TURN_EVENTS);
    const { runTurn } = await import("../lib/agent/engine");
    const { storedCoachStream } = await import("../lib/agent/stream");
    const { stopTurnEventListener } = await import("../lib/agent/turn-events");
    const { GET } = await import("../app/api/agent/run/route");
    t.after(stopTurnEventListener);
    const second = gate();
    const turn = input();
    const response = storedCoachStream(
      new Request("http://localhost"),
      "coach",
      turn.id,
      (emit, signal, onAttempt) =>
        runTurn(
          user,
          turn,
          async (_messages, _tools, _signal, onText) => {
            onText?.("First part. ");
            await second.opened;
            for (const piece of ["Second ", "part."]) {
              onText?.(piece);
              await sleep(10);
            }
            return { role: "assistant", content: "First part. Second part." };
          },
          { emit, signal, onAttempt },
        ),
      // As the iPhone sends it.
      { key: `${user}:${turn.id}`, background: true },
    );
    const first = await readUntil(response, (frames) =>
      frames.some((f) => f.data.includes('"delta":"First part. "')),
    );
    const seen = first.at(-1)!.id!;
    assert.ok(seen > 0);
    // The phone lost its connection mid-reply; Coach carries on.
    await sleep(100);
    const status = async () =>
      (
        await pool.query("SELECT status FROM agent_turns WHERE id=$1", [
          turn.id,
        ])
      ).rows[0].status;
    assert.equal(await status(), "running");

    const resume = (query: string, extra: Record<string, string> = {}) =>
      GET(
        new Request(`${headers.Origin}/api/agent/run?${query}`, {
          headers: { ...headers, ...extra },
        }),
      );
    const reconnected = await resume(`turnId=${turn.id}&after=${seen}`);
    assert.equal(reconnected.status, 200);
    const rest = reconnected.text();
    second.open();
    const later = framesOf(await rest);
    assert.equal(await status(), "done");
    assert.deepEqual(
      later.map((f) => f.id),
      later.map((_, i) => seen + 1 + i),
      "every event after the last one read, once, in order",
    );
    assert.equal(typeOf(later.at(-1)!), "RUN_FINISHED");
    const saved = await rows(turn.id);
    assert.deepEqual(
      [...first.filter((f) => f.id), ...later].map((f) => [f.id, f.data]),
      saved.map((r) => [r.seq, r.event]),
    );
    const reply = [...first, ...later]
      .map((f) => JSON.parse(f.data))
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => e.delta)
      .join("");
    assert.equal(reply, "First part. Second part.");

    // The same with the standard Last-Event-ID header, after the turn ended.
    assert.deepEqual(
      framesOf(
        await (
          await resume(`turnId=${turn.id}`, { "Last-Event-ID": String(seen) })
        ).text(),
      ),
      later,
    );
    // From the start when the app read nothing.
    const whole = framesOf(await (await resume(`turnId=${turn.id}`)).text());
    assert.equal(typeOf(whole[0]), "RUN_STARTED");
    assert.deepEqual(
      whole.slice(1).map((f) => f.id),
      saved.map((r) => r.seq),
    );
    // Only the account's own turns, and only with a turn id.
    const stranger = await setup();
    t.after(stranger.cleanUp);
    assert.equal(
      (
        await GET(
          new Request(
            `${headers.Origin}/api/agent/run?turnId=${turn.id}&after=0`,
            { headers: stranger.headers },
          ),
        )
      ).status,
      404,
    );
    assert.equal((await resume("turnId=not-a-turn")).status, 400);
  },
);

test(
  "a turn run again after a crash streams a coach.reset before the new attempt's events",
  { skip },
  async (t) => {
    const { pool, user, headers, cleanUp, rows } = await setup();
    t.after(cleanUp);
    process.env.COACH_TURN_EVENTS = "1";
    t.after(() => delete process.env.COACH_TURN_EVENTS);
    const { runTurn, failStaleTurns, STALE_TURN_MS } =
      await import("../lib/agent/engine");
    const { storedCoachStream, cancelRun } =
      await import("../lib/agent/stream");
    const { stopTurnEventListener, deleteEndedTurnEvents } =
      await import("../lib/agent/turn-events");
    const { GET } = await import("../app/api/agent/run/route");
    t.after(stopTurnEventListener);
    const turn = input();
    const key = `${user}:${turn.id}`;
    // The first attempt gets half a reply out, then its server goes away.
    const cutOff = storedCoachStream(
      new Request("http://localhost"),
      "coach",
      turn.id,
      (emit, signal, onAttempt) =>
        runTurn(
          user,
          turn,
          async (_messages, _tools, signal, onText) => {
            onText?.("Half an ");
            await sleep(300);
            onText?.("answer");
            await new Promise((_, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason)),
            );
            throw Error("unreachable");
          },
          { emit, signal, onAttempt },
        ),
      { key, background: true },
    );
    const reader = cutOff.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"delta":"answer"'))
      text += decoder.decode((await reader.read()).value, { stream: true });
    // The app read up to the first piece; the second never reached it.
    const seen = framesOf(text).find((f) =>
      f.data.includes('"delta":"Half an "'),
    )!.id!;
    // The sweeper finds it cut off; the process that ran it is gone (here,
    // stopped), and its stream ends without a last event.
    assert.equal(
      await failStaleTurns({
        userId: user,
        now: new Date(Date.now() + STALE_TURN_MS + 1000),
      }),
      1,
    );
    assert.equal(cancelRun(key), true);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const firstAttempt = framesOf(text);
    assert.ok(
      firstAttempt.every(
        (f) => !["RUN_FINISHED", "RUN_ERROR"].includes(typeOf(f)),
      ),
    );
    const firstRows = await rows(turn.id);
    assert.ok(firstRows.length >= seen);

    // An app that had read up to `seen` reconnects as the retry starts.
    const reconnected = await GET(
      new Request(
        `${headers.Origin}/api/agent/run?turnId=${turn.id}&after=${seen}`,
        { headers },
      ),
    );
    const resumed = reconnected.text();
    const retried = framesOf(
      await storedCoachStream(
        new Request("http://localhost"),
        "coach",
        turn.id,
        (emit, signal, onAttempt) =>
          runTurn(
            user,
            turn,
            async (_messages, _tools, _signal, onText) => {
              onText?.("A whole answer.");
              return { role: "assistant", content: "A whole answer." };
            },
            { emit, signal, onAttempt },
          ),
        { key, background: true },
      ).text(),
    );
    const saved = await rows(turn.id);
    const attempt2 = saved.filter((r) => r.attempt === 2);
    assert.deepEqual(
      saved.map((r) => r.attempt),
      [...firstRows.map(() => 1), ...attempt2.map(() => 2)],
    );
    assert.equal(attempt2[0].seq, firstRows.length + 1, "numbered on");
    assert.equal(
      (
        await pool.query(
          "SELECT attempt, status FROM agent_turns WHERE id=$1",
          [turn.id],
        )
      ).rows[0].attempt,
      2,
    );
    // The retry's own stream is that attempt alone, with no reset.
    assert.equal(typeOf(retried[0]), "RUN_STARTED");
    assert.deepEqual(
      retried.slice(1).map((f) => f.id),
      attempt2.map((r) => r.seq),
    );

    // The reconnected app: the first attempt's rest, a reset, the retry.
    const live = framesOf(await resumed);
    const reset = live.findIndex((f) => typeOf(f) === "CUSTOM");
    assert.ok(reset >= 0, "a coach.reset was sent");
    assert.deepEqual(JSON.parse(live[reset].data), {
      type: "CUSTOM",
      name: "coach.reset",
      value: { attempt: 2 },
    });
    assert.equal(live[reset].id, undefined);
    assert.deepEqual(
      live.slice(0, reset).map((f) => f.id),
      firstRows.filter((r) => r.seq > seen).map((r) => r.seq),
    );
    assert.deepEqual(
      live.slice(reset + 1).map((f) => [f.id, f.data]),
      attempt2.map((r) => [r.seq, r.event]),
    );
    assert.equal(JSON.parse(live.at(-1)!.data).result.reply, "A whole answer.");
    // Read from the start, only the latest attempt is sent.
    const fresh = framesOf(
      await (
        await GET(
          new Request(`${headers.Origin}/api/agent/run?turnId=${turn.id}`, {
            headers,
          }),
        )
      ).text(),
    );
    assert.equal(typeOf(fresh[0]), "RUN_STARTED");
    assert.deepEqual(
      fresh.slice(1).map((f) => f.id),
      attempt2.map((r) => r.seq),
    );

    // Events go about ten minutes after the turn ends; a running turn's stay.
    const running = crypto.randomUUID();
    await pool.query(
      "INSERT INTO agent_turns(id,user_id,question,status,started_at) VALUES ($1,$2,'Still going','running',now())",
      [running, user],
    );
    await pool.query(
      `INSERT INTO agent_turn_events(turn_id,seq,attempt,event) VALUES ($1,1,1,'{"type":"STEP_STARTED","stepName":"Preparing your response"}')`,
      [running],
    );
    assert.equal(await deleteEndedTurnEvents({ userId: user }), 0);
    assert.equal(
      await deleteEndedTurnEvents({
        userId: user,
        now: new Date(Date.now() + 11 * 60000),
      }),
      saved.length,
    );
    assert.deepEqual(await rows(turn.id), []);
    assert.equal((await rows(running)).length, 1);
  },
);

test(
  "a reader in another process is woken by NOTIFY, polls without it, and stops when a turn ends without a last event",
  { skip },
  async (t) => {
    const { pool, user, headers, cleanUp } = await setup();
    t.after(cleanUp);
    process.env.COACH_TURN_EVENTS = "1";
    t.after(() => delete process.env.COACH_TURN_EVENTS);
    const { stopTurnEventListener } = await import("../lib/agent/turn-events");
    const { GET } = await import("../app/api/agent/run/route");
    t.after(stopTurnEventListener);
    const running = async () => {
      const id = crypto.randomUUID();
      await pool.query(
        "INSERT INTO agent_turns(id,user_id,question,status,started_at) VALUES ($1,$2,'Written elsewhere','running',now())",
        [id, user],
      );
      return id;
    };
    // As the writer in another process writes them.
    const write = (turnId: string, seq: number, event: object, notify = true) =>
      pool.query(
        notify
          ? `WITH written AS (INSERT INTO agent_turn_events(turn_id,seq,attempt,event) VALUES ($1,$2,1,$3) RETURNING 1)
             SELECT pg_notify('agent_turn_events', $1)`
          : "INSERT INTO agent_turn_events(turn_id,seq,attempt,event) VALUES ($1,$2,1,$3)",
        [turnId, seq, JSON.stringify(event)],
      );
    const step = { type: "STEP_STARTED", stepName: "Preparing your response" };
    const follow = async (turnId: string) =>
      frameReader(
        await GET(
          new Request(`${headers.Origin}/api/agent/run?turnId=${turnId}`, {
            headers,
          }),
        ),
      );

    const turn = await running();
    const next = await follow(turn);
    assert.equal(typeOf((await next())!), "RUN_STARTED");
    const shared = () =>
      (globalThis as { coachTurnEvents?: { listener?: unknown } })
        .coachTurnEvents;
    while (!shared()?.listener) await sleep(20);
    // The reader is now waiting out its two-second poll.
    await sleep(300);
    let sent = Date.now();
    await write(turn, 1, step);
    assert.equal((await next())!.id, 1);
    assert.ok(
      Date.now() - sent < 1000,
      `woken by its notification, not the poll (${Date.now() - sent} ms)`,
    );
    // Without a notification it is found by the poll.
    sent = Date.now();
    await write(turn, 2, { ...step, type: "STEP_FINISHED" }, false);
    assert.equal((await next())!.id, 2);
    assert.ok(Date.now() - sent < 3000);
    await pool.query("UPDATE agent_turns SET status='done' WHERE id=$1", [
      turn,
    ]);
    await write(turn, 3, {
      type: "RUN_FINISHED",
      threadId: "coach",
      runId: turn,
      result: { reply: "Seven hours.", proposals: [] },
    });
    assert.equal((await next())!.id, 3);
    assert.equal(await next(), undefined, "the stream ends with the turn");

    // Stopped, or cut off and swept: no last event, and the stream still ends.
    const stopped = await running();
    await write(stopped, 1, step);
    const nextStopped = await follow(stopped);
    assert.equal(typeOf((await nextStopped())!), "RUN_STARTED");
    assert.equal((await nextStopped())!.id, 1);
    await pool.query("UPDATE agent_turns SET status='failed' WHERE id=$1", [
      stopped,
    ]);
    const ended = Date.now();
    assert.equal(await nextStopped(), undefined);
    assert.ok(Date.now() - ended < 6000, `${Date.now() - ended} ms`);
  },
);

test(
  "a closed connection still stops a run that isn't a background one, as the website's Stop does",
  { skip },
  async (t) => {
    const { pool, user, cleanUp, rows } = await setup();
    t.after(cleanUp);
    const { runTurn } = await import("../lib/agent/engine");
    const { storedCoachStream } = await import("../lib/agent/stream");
    const { stopTurnEventListener } = await import("../lib/agent/turn-events");
    t.after(stopTurnEventListener);
    const go = gate();
    // Model calls stopped before their reply was done.
    let stopped = 0;
    const send = (
      turn: ReturnType<typeof input>,
      options: { background?: boolean; connection?: AbortSignal } = {},
    ) =>
      storedCoachStream(
        new Request("http://localhost", { signal: options.connection }),
        "coach",
        turn.id,
        (emit, signal, onAttempt) =>
          runTurn(
            user,
            turn,
            async (_messages, _tools, signal, onText) => {
              onText?.("Logging ");
              await Promise.race([
                go.opened,
                new Promise((resolve) =>
                  signal.addEventListener("abort", resolve),
                ),
              ]);
              if (signal.aborted) {
                stopped++;
                throw signal.reason;
              }
              onText?.("two eggs.");
              return { role: "assistant", content: "Logging two eggs." };
            },
            { emit, signal, onAttempt },
          ),
        { key: `${user}:${turn.id}`, background: options.background },
      );
    const drafting = (frames: Frame[]) =>
      frames.some((f) => f.data.includes('"delta":"Logging "'));
    const status = async (turnId: string) =>
      (await pool.query("SELECT status FROM agent_turns WHERE id=$1", [turnId]))
        .rows[0].status as string;
    const until = async (check: () => Promise<boolean> | boolean) => {
      const end = Date.now() + 5000;
      while (!(await check())) {
        assert.ok(Date.now() < end, "in time");
        await sleep(20);
      }
    };
    const lastEvents = async (turnId: string) =>
      (await rows(turnId)).filter((r) =>
        /"RUN_(FINISHED|ERROR)"/.test(r.event),
      );

    // The website's Stop cancels the response it is reading.
    const cancelled = input();
    await readUntil(send(cancelled), drafting);
    await until(async () => (await status(cancelled.id)) === "failed");
    assert.equal(stopped, 1);
    assert.deepEqual(await lastEvents(cancelled.id), []);

    // So does the page going away, which ends the request.
    const connection = new AbortController();
    const left = input();
    const next = frameReader(send(left, { connection: connection.signal }));
    while (true) {
      const frame = await next();
      assert.ok(frame);
      if (drafting([frame])) break;
    }
    connection.abort();
    const rest: Frame[] = [];
    for (let frame = await next(); frame; frame = await next())
      rest.push(frame);
    assert.ok(
      rest.every((f) => !["RUN_FINISHED", "RUN_ERROR"].includes(typeOf(f))),
    );
    assert.equal(await status(left.id), "failed");
    assert.equal(stopped, 2);

    // The iPhone's background mode carries on to the saved reply.
    const background = input();
    await readUntil(send(background, { background: true }), drafting);
    await sleep(200);
    assert.equal(await status(background.id), "running");
    go.open();
    await until(async () => (await status(background.id)) === "done");
    assert.equal(stopped, 2);
    const [finished] = await lastEvents(background.id);
    assert.equal(JSON.parse(finished.event).result.reply, "Logging two eggs.");
  },
);
