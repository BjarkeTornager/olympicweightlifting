// Runs one voice-coach conversation against the real Gemini Live model, with
// the app's own instructions, tools and journal actions on a test account.
// The athlete speaks as text; the coach's speech is read from its transcript.
import { performance } from "node:perf_hooks";
import { localClock } from "../../lib/agent/time-context";
import { readJournal } from "../../lib/server";
import { recentConversations } from "../../lib/conversation-memory";
import {
  mintVoiceToken,
  voiceContext,
  voiceInstruction,
  voiceSetup,
  VOICE_SOCKET_URL,
} from "../../lib/voice-checkin";
import {
  runVoiceTool,
  voiceFailure,
  voiceToolArgs,
} from "../../lib/voice-actions";
import {
  liveEvents,
  NUDGE_AFTER_MS,
  promisesAction,
  WAITING_NUDGE,
} from "../../lib/voice-live";
import type { Scenario, Trial, Turn, ToolCall } from "./core";
import { simulateAthlete } from "./models";

const TRIAL_TIMEOUT_MS = 180000;
// After the coach's goodbye, how long to wait for anything further.
const AFTER_END_MS = 4000;
// How long the athlete waits after the coach stops before answering.
const ATHLETE_PAUSE_MS = 1500;

export async function runVoice(
  scenario: Scenario,
  userId: string,
  timezone: string,
): Promise<Omit<Trial, "before" | "after">> {
  const clock = localClock(new Date(), timezone);
  const { state } = await readJournal(userId);
  const setup = voiceSetup(
    voiceInstruction(
      voiceContext(state, clock.date),
      clock,
      "Sam",
      scenario.purpose ?? "checkin",
      await recentConversations(userId, { limit: 10 }),
    ),
  );
  const token = await mintVoiceToken(setup);
  const transcript: Turn[] = [];
  const calls: ToolCall[] = [];
  const latencies: number[] = [];
  const scripted = Array.isArray(scenario.athlete)
    ? [...scenario.athlete]
    : null;
  let athleteTurns = 0;
  let said = "";
  let pending = 0;
  let spokeAt = 0;
  let waitingFirstAudio = false;
  let endedAt: number | undefined;
  let reply: ReturnType<typeof setTimeout> | undefined;
  let nudge: ReturnType<typeof setTimeout> | undefined;
  // Set once the athlete has nothing more to say.
  let finishing = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let error: string | undefined;

  await new Promise<void>((finish) => {
    const socket = new WebSocket(
      `${VOICE_SOCKET_URL}?access_token=${encodeURIComponent(token)}`,
    );
    socket.binaryType = "arraybuffer";
    const send = (m: object) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    };
    const done = (reason?: string) => {
      if (reason && !error) error = reason;
      clearTimeout(timer);
      if (socket.readyState <= WebSocket.OPEN) socket.close();
      finish();
    };
    const timer = setTimeout(() => done("timed out"), TRIAL_TIMEOUT_MS);
    const speak = (text: string) => {
      athleteTurns++;
      transcript.push({ role: "athlete", text });
      spokeAt = performance.now();
      waitingFirstAudio = true;
      send({ realtimeInput: { text } });
    };
    // The athlete answers after each completed coach turn.
    const nextAthlete = async () => {
      if (endedAt !== undefined) return;
      const line = scripted
        ? scripted.shift()
        : athleteTurns < (scenario.athlete as { maxTurns: number }).maxTurns
          ? await simulateAthlete(
              (scenario.athlete as { goal: string }).goal,
              transcript,
            )
          : null;
      if (line) speak(line);
      // The athlete is done; let the coach finish what it is saying.
      else {
        finishing = true;
        finishTimer = setTimeout(() => done(), AFTER_END_MS * 3);
      }
    };
    socket.onopen = () => send({ setup });
    socket.onclose = (e) => {
      if (e.code !== 1000) done(`socket closed ${e.code} ${e.reason}`);
      else done();
    };
    socket.onmessage = async (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      for (const e of liveEvents(raw)) {
        if (e.type === "ready")
          send({ realtimeInput: { text: "(The athlete started the call.)" } });
        else if (e.type === "audio" && waitingFirstAudio) {
          latencies.push(Math.round(performance.now() - spokeAt));
          waitingFirstAudio = false;
        } else if (e.type === "said") said += e.text;
        else if (e.type === "turnComplete") {
          if (said.trim())
            transcript.push({ role: "coach", text: said.trim() });
          const promised = promisesAction(said);
          said = "";
          if (finishing) {
            clearTimeout(finishTimer);
            finishTimer = setTimeout(() => done(), AFTER_END_MS);
          }
          // Like a person on a call, the athlete answers after a short
          // pause, and never while the coach is still checking or saving.
          clearTimeout(reply);
          clearTimeout(nudge);
          if (promised)
            // As the app does: a stalled promise gets a nudge, and the
            // athlete waits for the answer it promised.
            nudge = setTimeout(() => {
              if (!pending) send({ realtimeInput: { text: WAITING_NUDGE } });
            }, NUDGE_AFTER_MS);
          else
            reply = setTimeout(() => {
              if (!pending) void nextAthlete();
            }, ATHLETE_PAUSE_MS);
        } else if (e.type === "toolCall")
          for (const call of e.calls) {
            clearTimeout(reply);
            clearTimeout(nudge);
            pending++;
            const args = call.args ?? {};
            let response: object;
            let ok = false;
            if (call.name === "end_check_in") {
              endedAt = athleteTurns;
              ok = true;
              response = { result: "ended" };
              setTimeout(() => done(), AFTER_END_MS);
            } else if (call.name in voiceToolArgs) {
              try {
                const result = await runVoiceTool(userId, {
                  id: crypto.randomUUID(),
                  name: call.name as keyof typeof voiceToolArgs,
                  args,
                  today: clock.date,
                  seenPhotoIds: [],
                });
                ok = result.ok;
                response = result.ok
                  ? { result: "data" in result ? result.data : result }
                  : { error: result.error };
              } catch (err) {
                response = { error: voiceFailure(err) };
              }
            } else
              response = {
                error:
                  "Not available in this test; ask the athlete to describe it.",
              };
            calls.push({
              name: call.name,
              args,
              ok,
              result: response,
              afterTurn: athleteTurns,
            });
            send({
              toolResponse: {
                functionResponses: [{ id: call.id, name: call.name, response }],
              },
            });
            pending--;
          }
      }
    };
  });
  return {
    scenario: scenario.id,
    coach: "voice",
    transcript,
    calls,
    latencies,
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(error ? { error } : {}),
  };
}
