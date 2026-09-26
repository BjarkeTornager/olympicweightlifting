// Interruption eval: while the coach answers, stream sounds into the real
// Gemini Live model and see whether it stops. Echo of the coach and distant
// chatter must not interrupt it; the athlete speaking to the phone must.
// npm run eval:barge-in -- --live   (uses the Gemini key; about a minute)
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (!process.argv.includes("--live"))
  throw Error("Use --live to authorize real model calls.");
import { emptyJournal } from "../../lib/domain";
import { localClock } from "../../lib/agent/time-context";
import {
  mintVoiceToken,
  voiceContext,
  voiceInstruction,
  voiceSetup,
  VOICE_SOCKET_URL,
} from "../../lib/voice-checkin";
import {
  createBargeInGate,
  liveEvents,
  pcmToBase64,
} from "../../lib/voice-live";
const key = process.env.GEMINI_API_KEY!;
// "Wait, stop a second" as speech, from Gemini TTS (24 kHz) resampled to 16 kHz.
async function speech(text: string) {
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
        },
      }),
    },
  ).then((r) => r.json());
  const b = Buffer.from(
    r.candidates[0].content.parts[0].inlineData.data,
    "base64",
  );
  const src = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
  const out = new Int16Array(Math.floor((src.length * 2) / 3));
  for (let i = 0; i < out.length; i++) out[i] = src[Math.floor(i * 1.5)];
  return out;
}
const bang = () =>
  Int16Array.from({ length: 16000 * 0.15 }, (_, i) =>
    Math.round(0.8 * 32767 * Math.sin(i / 2) * Math.exp(-i / 800)),
  );
const clip = await speech("Wait, stop a second please.");
let last = false;
async function trial(
  label: string,
  sound: Int16Array | "echo",
  gated: boolean,
) {
  const clock = localClock(new Date(), "Europe/Copenhagen");
  const setup = voiceSetup(
    voiceInstruction(voiceContext(emptyJournal(), clock.date), clock, "Sam"),
  );
  const ws = new WebSocket(
    `${VOICE_SOCKET_URL}?access_token=${encodeURIComponent(await mintVoiceToken(setup))}`,
  );
  ws.binaryType = "arraybuffer";
  const send = (m: object) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const gate = createBargeInGate();
  let interrupted = false,
    streaming = false;
  // The coach's audio as it plays, 16 kHz, for echo and for its level.
  const played: number[] = [];
  let playedAt = 0;
  const level = (a: Int16Array) => {
    let t = 0;
    for (const x of a) t += (x / 32768) ** 2;
    return Math.sqrt(t / Math.max(1, a.length));
  };
  return new Promise<void>((done) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ws.close();
      console.log(
        label.padEnd(44),
        interrupted ? "INTERRUPTED" : "kept talking",
      );
      last = interrupted;
      done();
    };
    setTimeout(finish, 40000);
    ws.onopen = () => send({ setup });
    ws.onmessage = async (e) => {
      const raw =
        typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
      for (const ev of liveEvents(raw)) {
        if (ev.type === "ready")
          send({
            realtimeInput: {
              text: "Tell me, in about eight sentences, how to warm up properly for heavy snatches.",
            },
          });
        if (ev.type === "interrupted") interrupted = true;
        if (ev.type === "audio") {
          const b = Buffer.from(ev.data, "base64");
          const src = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
          for (let i = 0; i < src.length; i += 1.5)
            played.push(src[Math.floor(i)]);
        }
        if (ev.type === "audio" && !streaming) {
          streaming = true;
          // Start 1.5 s into the coach's answer, in 100 ms chunks like the app.
          await new Promise((r) => setTimeout(r, 1500));
          const total = sound === "echo" ? 16000 * 5 : sound.length + 16000;
          for (let i = 0; i < total; i += 1600) {
            // What the speaker is playing now, and its echo in the microphone.
            const now = Int16Array.from(
              played.slice(playedAt, playedAt + 1600),
            );
            playedAt += 1600;
            const chunk =
              sound === "echo"
                ? Int16Array.from(now, (x) => Math.round(x * 0.4))
                : (() => {
                    const c = new Int16Array(1600);
                    c.set(sound.slice(i, i + 1600));
                    return c;
                  })();
            for (const out of gated ? gate(chunk, true, level(now)) : [chunk])
              send({
                realtimeInput: {
                  audio: {
                    data: pcmToBase64(out.buffer as ArrayBuffer),
                    mimeType: "audio/pcm;rate=16000",
                  },
                },
              });
            await new Promise((r) => setTimeout(r, 100));
          }
          setTimeout(finish, 3000);
        }
      }
    };
  });
}
const results: { label: string; interrupted: boolean; expected: boolean }[] =
  [];
// Set a clip to a given loudness (RMS of its voiced part), like a person at a
// given distance from the phone.
const loudness = (a: Int16Array, target: number) => {
  let total = 0;
  let voiced = 0;
  for (const x of a)
    if (Math.abs(x) > 300) {
      total += (x / 32768) ** 2;
      voiced++;
    }
  const k = target / Math.sqrt(total / Math.max(1, voiced));
  return Int16Array.from(a, (x) =>
    Math.max(-32768, Math.min(32767, Math.round(x * k))),
  );
};
// Model interruptions vary, so each case runs several times, with the app's
// noise gate and without it for comparison.
const trials = Number(process.argv[process.argv.indexOf("--k") + 1]) || 3;
for (const [label, sound, shouldStop] of [
  ["coach's own voice echoing (40%)", "echo", false],
  ["distant chatter (quiet speech)", loudness(clip, 0.02), false],
  ["athlete speaking to the phone", loudness(clip, 0.15), true],
  ["short bang", bang(), false],
] as [string, Int16Array | "echo", boolean][])
  for (const gated of [true, false]) {
    let stopped = 0;
    for (let i = 0; i < trials; i++) {
      await trial(`${label} | ${gated ? "gate" : "no gate"}`, sound, gated);
      if (last) stopped++;
    }
    if (gated)
      results.push({
        label,
        interrupted: shouldStop ? stopped === trials : stopped > 0,
        expected: shouldStop,
      });
    console.log(
      `  → ${label}, ${gated ? "gate" : "no gate"}: coach stopped ${stopped}/${trials}\n`,
    );
  }
const wrong = results.filter((r) => r.interrupted !== r.expected);
console.log(
  wrong.length
    ? `\nFAILED: ${wrong.map((r) => r.label).join("; ")}`
    : "\nAll interruption cases behave as intended with the gate.",
);
process.exit(wrong.length ? 1 : 0);
