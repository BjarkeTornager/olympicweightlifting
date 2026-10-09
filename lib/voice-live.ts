// Wire format helpers for the Gemini Live API. Kept free of browser audio so
// the protocol handling can be tested directly.
import type { SavedVisual } from "./coach-visuals";

export function pcmToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// 16-bit little-endian PCM (24 kHz from the model) to Web Audio samples.
export function base64ToFloat32(data: string) {
  const binary = atob(data);
  const samples = new Float32Array(binary.length >> 1);
  for (let i = 0; i < samples.length; i++) {
    const value =
      binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}

// Google's prepaid voice credit ran out: retrying cannot help.
export const VOICE_CREDIT_MESSAGE =
  "Voice is paused because its Google credit has run out. You can keep typing to Coach.";
export const isCreditError = (message: string) =>
  /prepayment credits|credit has run out|RESOURCE_EXHAUSTED/i.test(message);

const lastSentence = (text: string) =>
  text
    .trim()
    .split(/(?<=[.?!])\s+/)
    .at(-1) ?? "";
// An offer ("let me know if you'd like me to draw it") waits for the
// athlete's answer; it is not a promise. "Let me check if you slept" is.
const offers =
  /\b(let me know|if you('d| would)? (like|want|prefer)|would you like|do you want)\b/i;

// A coach turn that promises an action ("let me check that") but ends
// without doing it leaves the athlete in silence; the app then nudges it.
// The iPhone app matches the same (LiveProtocol.promisesAction).
export const promisesAction = (text: string) => {
  const last = lastSentence(text);
  return (
    !offers.test(last) &&
    /\b(let me|i'?ll|i will|i'?m going to|one moment|give me a (second|moment))\b[^.?!]{0,40}\b(check|look|see|find|review|save|log|record|update|get|pull|calculate|sort|fix|add|show|put|draw)/i.test(
      last,
    )
  );
};
// A card promised ("I'll put it on your screen"): writing a whole recipe or
// table takes longer than a save, so the nudge waits longer.
export const promisesCard = (text: string) =>
  promisesAction(text) && /\b(show|put|draw|screen)/i.test(lastSentence(text));
export const WAITING_NUDGE =
  "(The athlete is waiting: do what you just said now, then answer.)";
// Counted from when the coach stops speaking.
export const NUDGE_AFTER_MS = 2500;
export const CARD_NUDGE_AFTER_MS = 6000;

export type FunctionCall = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
};

export type LiveEvent =
  | { type: "ready" }
  | { type: "audio"; data: string }
  | { type: "heard"; text: string }
  | { type: "said"; text: string }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "toolCall"; calls: FunctionCall[] }
  | { type: "cancelled"; ids: string[] }
  | { type: "goAway" }
  | { type: "resumeHandle"; handle: string };

type ServerMessage = {
  setupComplete?: object;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: FunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  goAway?: object;
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
};

export function liveEvents(raw: string): LiveEvent[] {
  const message = JSON.parse(raw) as ServerMessage;
  const events: LiveEvent[] = [];
  if (message.setupComplete) events.push({ type: "ready" });
  const content = message.serverContent;
  if (content) {
    if (content.interrupted) events.push({ type: "interrupted" });
    if (content.inputTranscription?.text)
      events.push({ type: "heard", text: content.inputTranscription.text });
    for (const part of content.modelTurn?.parts ?? [])
      if (part.inlineData?.data)
        events.push({ type: "audio", data: part.inlineData.data });
    if (content.outputTranscription?.text)
      events.push({ type: "said", text: content.outputTranscription.text });
    if (content.turnComplete) events.push({ type: "turnComplete" });
  }
  if (message.toolCall?.functionCalls?.length)
    events.push({ type: "toolCall", calls: message.toolCall.functionCalls });
  if (message.toolCallCancellation?.ids?.length)
    events.push({ type: "cancelled", ids: message.toolCallCancellation.ids });
  if (message.goAway) events.push({ type: "goAway" });
  const resume = message.sessionResumptionUpdate;
  if (resume?.resumable && resume.newHandle)
    events.push({ type: "resumeHandle", handle: resume.newHandle });
  return events;
}

export type Line = { role: "you" | "coach"; text: string };
// A save shown in the conversation where it happened.
export type Receipt = {
  role: "save";
  id: string;
  label: string;
  state: "saving" | "saved" | "failed";
};
// A card the coach put on screen, shown where it happened.
export type Card = { role: "card"; id: string; visual: SavedVisual };
export type Entry = Line | Receipt | Card;

// A card shown in the call: a new card at the end, or one already on screen
// updated where it is (its picture added). The iPhone app does the same
// (VoiceCall.placing).
export const placeCard = (entries: Entry[], card: Card): Entry[] =>
  entries.some((e) => e.role === "card" && e.id === card.id)
    ? entries.map((e) => (e.role === "card" && e.id === card.id ? card : e))
    : [...entries, card];

// What was said, for the stored transcript: saves and cards are kept in
// Coach as their own turns.
export const spokenLines = (entries: Entry[]) =>
  entries.filter((e): e is Line => e.role === "you" || e.role === "coach");

// The last few lines for a coach whose call started afresh after a drop,
// with the cards on screen and their ids, which show_picture needs. The
// iPhone app sends the same (VoiceCall.recap).
export const recapLines = (entries: Entry[]) =>
  entries
    .filter((e) => e.role !== "save")
    .slice(-8)
    .map((e) =>
      e.role === "card"
        ? `(Card on screen: ${e.visual.content.title}, ${e.visual.content.kind}, card_id ${e.id})`
        : `${e.role === "you" ? "Athlete" : "Coach"}: ${e.text}`,
    )
    .join("\n");

// Fragments usually carry their own spaces ("Did you " + "train?"), but a
// word sometimes arrives without one ("for" + "last night"). A space goes
// between words, numbers and after punctuation, but not inside a number
// such as 7.5. The iPhone app joins them the same way (LiveTranscript).
export function joinFragment(text: string, next: string) {
  if (!text || /\s$/.test(text) || /^\s/.test(next)) return text + next;
  if (/\d[.,]$/.test(text) && /^\d/.test(next)) return text + next;
  return /[\p{L}\p{N}.,!?;:…)]$/u.test(text) && /^[\p{L}\p{N}(]/u.test(next)
    ? `${text} ${next}`
    : text + next;
}

const endsSentence = (text: string) => /[.!?…]["”')\]]*\s*$/.test(text);

// Transcription arrives in fragments. Consecutive fragments from the same
// speaker extend the current line. A completed turn or an interruption
// starts a new line, except in the middle of a sentence: the coach's reply
// sometimes arrives across two turns.
export function appendLine(
  lines: Entry[],
  role: Line["role"],
  text: string,
  fresh = false,
): Entry[] {
  const last = lines.at(-1);
  if (last && last.role === role && (!fresh || !endsSentence(last.text)))
    return [
      ...lines.slice(0, -1),
      { role, text: joinFragment(last.text, text) },
    ];
  // Noise can transcribe as nothing: no empty line for it.
  if (!text.trim()) return lines;
  return [...lines, { role, text: text.trimStart() }];
}

// While the coach is speaking, background noise, distant voices and the
// coach's own voice echoing from the speaker must not interrupt it. The
// microphone is only let through when sound stands clearly above both the
// room's noise floor and the coach's current output level for about a third
// of a second, like someone speaking to the phone; otherwise the model hears
// silence. The start of that speech is kept, not clipped. When the coach is
// quiet, everything passes as normal.
// Half a second of sound well above the room, as when someone speaks to the
// phone: a cough, a clatter or a TV across the room stays out.
export function createBargeInGate({
  holdChunks = 5,
  ratio = 4,
  minLevel = 0.03,
  // How loud, relative to the coach's own playback, the microphone must be.
  // Echo reaching the microphone is far quieter than the playback (the
  // phone's echo cancellation removes most of it); someone speaking to the
  // phone is about as loud or louder.
  echoRatio = 0.6,
} = {}) {
  let floor = 0.005;
  let loud: Int16Array[] = [];
  let open = false;
  const level = (pcm: Int16Array) => {
    let sum = 0;
    for (const x of pcm) sum += (x / 32768) ** 2;
    return Math.sqrt(sum / Math.max(1, pcm.length));
  };
  // coachLevel: RMS of the coach's audio being played right now (0–1).
  return (
    pcm: Int16Array,
    coachSpeaking: boolean,
    coachLevel = 0,
  ): Int16Array[] => {
    const rms = level(pcm);
    if (!coachSpeaking) {
      // Learn the room's background level while nobody is being gated.
      floor = floor * 0.95 + Math.min(rms, 0.2) * 0.05;
      open = false;
      loud = [];
      return [pcm];
    }
    if (open) return [pcm];
    if (rms > Math.max(minLevel, floor * ratio, coachLevel * echoRatio)) {
      loud.push(pcm);
      if (loud.length >= holdChunks) {
        open = true;
        const speech = loud;
        loud = [];
        return speech;
      }
    } else loud = [];
    return [new Int16Array(pcm.length)];
  };
}
