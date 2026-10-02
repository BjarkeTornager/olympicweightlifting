// Records the short samples played when picking a voice in the iPhone app,
// through the same setups a call uses (Gemini Live and the ElevenLabs agent),
// so each sounds as it will on a call. Writes AAC files under
// public/voice-samples and the list of them to lib/voice-samples.json.
//
//   GEMINI_API_KEY=… ELEVENLABS_API_KEY=… npx tsx scripts/voice-samples.ts [provider/id …]
//
// With arguments, records only those voices. Each sample's transcript must
// match the line, or it is recorded again.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoachLanguage } from "../lib/coach-language";
import {
  mintVoiceToken,
  voiceSetup,
  VOICE_SOCKET_URL,
} from "../lib/voice-checkin";
import { elevenLabsSignedUrl, elevenLabsStart } from "../lib/voice-elevenlabs";
import { liveEvents } from "../lib/voice-live";
import { voiceChoices } from "../lib/voice-options";
import type { VoiceProvider } from "../lib/voice-elevenlabs";

const lines: Record<CoachLanguage, string> = {
  // No numbers: transcripts write them as digits, which the check can't match.
  en: "Morning! Great work on the squats yesterday. How did you sleep last night?",
  da: "Godmorgen! Flot arbejde med squats i går. Hvordan har du sovet i nat?",
};
const instruction = (line: string) =>
  `You are recording a short voice sample for a fitness app. Your only task: when asked, say exactly the following words once, warmly and confidently like a coach at the platform, with nothing before or after them and without calling any tool:\n"${line}"`;
const start = "(Record the sample now.)";
const manifestPath = "lib/voice-samples.json";

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[[a-z ]+\]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
/** Share of the line's words the coach actually said. */
function overlap(line: string, said: string) {
  const spoken = new Set(words(said));
  const expected = words(line);
  return expected.filter((w) => spoken.has(w)).length / expected.length;
}

async function google(voice: string, language: CoachLanguage) {
  const setup = voiceSetup(instruction(lines[language]), undefined, {
    voice,
    language,
  });
  const socket = new WebSocket(
    `${VOICE_SOCKET_URL}?access_token=${encodeURIComponent(await mintVoiceToken(setup))}`,
  );
  socket.binaryType = "arraybuffer";
  const audio: Buffer[] = [];
  let said = "";
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(
      () => fail(Error("Gemini sample timed out")),
      45000,
    );
    socket.onopen = () => socket.send(JSON.stringify({ setup }));
    socket.onmessage = (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data);
      for (const ev of liveEvents(raw)) {
        if (ev.type === "ready")
          socket.send(JSON.stringify({ realtimeInput: { text: start } }));
        if (ev.type === "audio") audio.push(Buffer.from(ev.data, "base64"));
        if (ev.type === "said") said += ev.text;
        if (ev.type === "turnComplete" && audio.length) {
          clearTimeout(timer);
          socket.close();
          done();
        }
      }
    };
    socket.onclose = (event) => {
      if (!audio.length)
        fail(Error(`Gemini closed: ${event.code} ${event.reason}`));
    };
  });
  return { pcm: Buffer.concat(audio), said };
}

async function elevenlabs(voice: string, language: CoachLanguage) {
  const socket = new WebSocket(await elevenLabsSignedUrl());
  const audio: Buffer[] = [];
  let said = "";
  let quiet: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(
      () => fail(Error("ElevenLabs sample timed out")),
      45000,
    );
    const finish = () => {
      clearTimeout(timer);
      socket.close();
      done();
    };
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    socket.onopen = () =>
      send(elevenLabsStart(instruction(lines[language]), { voice, language }));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "conversation_initiation_metadata")
        send({ type: "user_message", text: start });
      if (message.type === "agent_response")
        said += message.agent_response_event.agent_response;
      if (message.type === "ping")
        send({ type: "pong", event_id: message.ping_event.event_id });
      if (message.type === "audio") {
        audio.push(Buffer.from(message.audio_event.audio_base_64, "base64"));
        // The reply has no end marker on this socket: two quiet seconds ends it.
        clearTimeout(quiet);
        quiet = setTimeout(finish, 2000);
      }
    };
    socket.onclose = (event) => {
      if (!audio.length)
        fail(Error(`ElevenLabs closed: ${event.code} ${event.reason}`));
    };
  });
  return { pcm: Buffer.concat(audio), said };
}

/** 24 kHz 16-bit mono PCM to AAC in an .m4a, with half a second's leading silence trimmed. */
function save(pcm: Buffer, path: string) {
  let first = 0;
  while (first < pcm.length - 2 && Math.abs(pcm.readInt16LE(first)) < 300)
    first += 2;
  const body = pcm.subarray(Math.max(0, first - 4800));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(body.length, 40);
  const wav = join(tmpdir(), `voice-sample-${process.pid}.wav`);
  writeFileSync(wav, Buffer.concat([header, body]));
  execFileSync("afconvert", [
    "-f",
    "m4af",
    "-d",
    "aac",
    "-b",
    "64000",
    wav,
    path,
  ]);
  rmSync(wav);
}

const only = process.argv.slice(2);
const manifest: Record<string, CoachLanguage[]> = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};
for (const provider of Object.keys(voiceChoices) as VoiceProvider[]) {
  for (const voice of voiceChoices[provider]) {
    const key = `${provider}/${voice.id}`;
    if (only.length && !only.includes(key)) continue;
    mkdirSync(`public/voice-samples/${provider}`, { recursive: true });
    for (const language of Object.keys(lines) as CoachLanguage[]) {
      for (let attempt = 1; ; attempt++) {
        const { pcm, said } =
          provider === "google"
            ? await google(voice.id, language)
            : await elevenlabs(voice.id, language);
        const match = overlap(lines[language], said);
        const seconds = pcm.length / 48000;
        console.log(
          `${key} ${language} attempt ${attempt}: ${seconds.toFixed(1)} s, ${Math.round(match * 100)}% of the line — ${said.trim()}`,
        );
        if ((match >= 0.85 && seconds > 2 && seconds < 15) || attempt === 3) {
          if (match < 0.85)
            throw Error(
              `${key} ${language}: the line was not said after 3 attempts`,
            );
          save(
            pcm,
            `public/voice-samples/${provider}/${voice.id}.${language}.m4a`,
          );
          manifest[key] = [
            ...new Set([...(manifest[key] ?? []), language]),
          ].sort();
          break;
        }
      }
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
}
