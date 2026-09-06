// Isolated native UI test server. Synthetic records only; no database, provider or Railway requests.
import { createServer } from "node:http";
import { emptyJournal, days, EXERCISES, today } from "../lib/domain";
import { dailyHealth, saveCheckin } from "../lib/health";
import { saveCardio } from "../lib/cardio";
import { prepareAction } from "../lib/agent/actions";
if (process.env.LIFT_IOS_FIXTURE !== "true")
  throw Error("Explicit LIFT_IOS_FIXTURE=true is required");
let state = emptyJournal(),
  revision = 0,
  turns: unknown[] = [];
const user = {
  id: "native-synthetic-account",
  name: "Alex",
  email: "native@example.test",
};
let disconnected = false,
  lostAck = false,
  lastMutation = "";
const reset = () => {
  disconnected = false;
  lostAck = false;
  lastMutation = "";
  state = emptyJournal();
  revision = 0;
  turns = [];
  saveCheckin(
    state,
    { date: today(), sleepHours: 7.75, waterMl: 1000, energy: 4, soreness: 2 },
    today(),
  );
  saveCardio(
    state,
    {
      activity: "cycling",
      date: today(),
      durationSeconds: 3600,
      distanceKm: 20,
      averageHeartRate: 135,
    },
    today(),
  );
};
reset();
let proposal: ReturnType<typeof prepareAction> | undefined;
createServer(async (req, res) => {
  try {
    const path = new URL(req.url!, "http://localhost").pathname;
    let bytes = "";
    for await (const chunk of req) {
      bytes += chunk;
      if (bytes.length > 5_000_000) throw Error("Too large");
    }
    const input = bytes ? JSON.parse(bytes) : {};
    const send = (value: unknown, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (path === "/__reset") {
      reset();
      return send({ ok: true });
    }
    if (path === "/__disconnect") {
      disconnected = true;
      return send({ ok: true });
    }
    if (path === "/__reconnect") {
      disconnected = false;
      return send({ ok: true });
    }
    if (path === "/__lose-ack") {
      lostAck = true;
      return send({ ok: true });
    }
    if (path === "/__state") return send({ state, revision });
    if (req.headers.authorization !== "Bearer synthetic-test-token")
      return send({ error: "Synthetic test authorization required" }, 401);
    if (disconnected)
      return send({ error: "Synthetic network unavailable" }, 503);
    if (path === "/api/session")
      return send({
        user,
        google: true,
        localPassword: false,
        canInvite: false,
      });
    if (path === "/api/mobile/overview")
      return send({
        state,
        revision,
        overview: dailyHealth(state, today()),
        programmes: days,
        exercises: EXERCISES,
      });
    if (path === "/api/images") return send({ images: [] });
    if (path === "/api/agent" && req.method === "GET")
      return send({ turns, enabled: true });
    if (path === "/api/mobile/prepare") {
      if (input.revision !== revision)
        return send({ error: "Refresh before saving" }, 409);
      const prepared = prepareAction(state, input.action, today());
      return send({ state: prepared.state, revision });
    }
    if (path === "/api/journal" && req.method === "PUT") {
      if (input.mutationId === lastMutation)
        return send({ state, revision, accountId: user.id });
      if (input.revision !== revision)
        return send({ error: "Changed on another device" }, 409);
      state = input.state;
      revision++;
      lastMutation = input.mutationId;
      if (lostAck) {
        lostAck = false;
        return send(
          { error: "Synthetic acknowledgement lost; retry from Recovery" },
          503,
        );
      }
      return send({ state, revision, accountId: user.id });
    }
    if (path === "/api/agent/run") {
      proposal = prepareAction(
        state,
        {
          kind: "record_cardio",
          cardio: {
            activity: "running",
            date: today(),
            durationSeconds: 1700,
            distanceKm: 5,
          },
        },
        today(),
      );
      const response = {
        reply:
          "I have prepared your run for review. Your journal will change only when you save.",
        proposals: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            status: "pending",
            title: proposal.title,
            detail: proposal.detail,
            cardio: proposal.cardio,
          },
        ],
        visuals: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            content: {
              kind: "table",
              title: "Activity details",
              columns: ["Activity", "Duration", "Distance"],
              rows: [["Running", "28 min 20 sec", "5 km"]],
            },
          },
        ],
      };
      turns.push({
        id: input.runId,
        question: input.messages[0].content,
        ...response,
        status: "done",
      });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      const event = (value: unknown) =>
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      event({ type: "RUN_STARTED" });
      event({
        type: "STEP_STARTED",
        stepName: "Reviewing your cardio activities",
      });
      setTimeout(() => {
        event({ type: "TEXT_MESSAGE_CONTENT", delta: response.reply });
        event({ type: "RUN_FINISHED", result: response });
        res.end();
      }, 600);
      return;
    }
    if (path === "/api/agent/action" && proposal) {
      state = proposal.state;
      revision++;
      (
        turns.at(-1) as { proposals: { status: string }[] }
      ).proposals[0].status = "saved";
      return send({ accountId: user.id, state, revision, status: "saved" });
    }
    if (path === "/api/auth/sign-out") return send({ success: true });
    send({ error: "Unmocked native UI fixture route" }, 404);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Synthetic fixture rejected input" }));
  }
}).listen(34567, "127.0.0.1", () =>
  console.log("Synthetic iOS fixture listening on localhost:34567"),
);
