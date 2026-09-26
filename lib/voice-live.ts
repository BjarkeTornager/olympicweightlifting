// Wire format helpers for the Gemini Live API. Kept free of browser audio so
// the protocol handling can be tested directly.

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
  | { type: "goAway" };

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
  return events;
}

export type Line = { role: "you" | "coach"; text: string };

// Transcription arrives in fragments. Consecutive fragments from the same
// speaker extend the current line unless a completed turn closed it.
export function appendLine(
  lines: Line[],
  role: Line["role"],
  text: string,
  fresh = false,
) {
  const last = lines.at(-1);
  if (last?.role === role && !fresh)
    return [...lines.slice(0, -1), { role, text: last.text + text }];
  return [...lines, { role, text: text.trimStart() }];
}
