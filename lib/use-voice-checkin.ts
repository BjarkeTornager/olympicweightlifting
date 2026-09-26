"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { privateFetch, privateRequestHeaders } from "./private-fetch";
import {
  appendLine,
  base64ToFloat32,
  liveEvents,
  pcmToBase64,
  type FunctionCall,
  type Line,
} from "./voice-live";

export type VoiceStatus =
  "idle" | "connecting" | "listening" | "speaking" | "ended" | "failed";
export type VoiceSave = {
  id: string;
  topic: string;
  report: string;
  state: "saving" | "saved" | "failed";
  detail?: string;
};
export type SaveResult = { ok: boolean; detail: string };
type Session = {
  socket?: WebSocket;
  context: AudioContext;
  stream?: MediaStream;
  sources: Set<AudioBufferSourceNode>;
  playAt: number;
  closed: boolean;
  lineClosed: boolean;
  timers: ReturnType<typeof setTimeout>[];
};

// One spoken check-in. Audio goes straight between this device and Google
// with a single-use token; every save is handed to Coach as a message.
export function useVoiceCheckin({
  headers,
  onSave,
}: {
  headers: () => Record<string, string>;
  onSave: (report: string) => Promise<SaveResult>;
}) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saves, setSaves] = useState<VoiceSave[]>([]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const session = useRef<Session | null>(null);

  const stop = useCallback((failure?: string) => {
    const s = session.current;
    if (!s || s.closed) return;
    s.closed = true;
    s.timers.forEach(clearTimeout);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.sources.forEach((source) => source.stop());
    if (s.socket && s.socket.readyState <= WebSocket.OPEN) s.socket.close();
    void s.context.close();
    session.current = null;
    setError(failure ?? "");
    setStatus(failure ? "failed" : "ended");
  }, []);

  useEffect(() => () => stop(), [stop]);

  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  };

  const start = async () => {
    if (session.current) return;
    // iOS only lets audio start from the tap itself, before any await.
    const context = new AudioContext();
    void context.resume();
    const s: Session = {
      context,
      sources: new Set(),
      playAt: 0,
      closed: false,
      lineClosed: true,
      timers: [],
    };
    session.current = s;
    setStatus("connecting");
    setError("");
    setLines([]);
    setSaves([]);
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const response = await privateFetch("/api/voice/session", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error ?? "Voice check-in could not start.");
      if (s.closed) return;
      await context.audioWorklet.addModule("/voice-capture-worklet.js");
      const socket = new WebSocket(data.url);
      socket.binaryType = "arraybuffer";
      s.socket = socket;
      const send = (message: object) => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify(message));
      };
      socket.onopen = () => send({ setup: data.setup });
      socket.onerror = () => stop("The voice connection failed.");
      socket.onclose = (event) => {
        if (!s.closed)
          stop(
            event.code === 1000
              ? undefined
              : `The call dropped${event.reason ? ` (${event.reason})` : ""}. Anything already saved is in Coach.`,
          );
      };
      socket.onmessage = (event) => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        for (const e of liveEvents(raw)) {
          if (e.type === "ready") {
            const mic = context.createMediaStreamSource(s.stream!);
            const capture = new AudioWorkletNode(context, "voice-capture");
            capture.port.onmessage = ({ data: pcm }) => {
              if (!mutedRef.current)
                send({
                  realtimeInput: {
                    audio: {
                      data: pcmToBase64(pcm as ArrayBuffer),
                      mimeType: "audio/pcm;rate=16000",
                    },
                  },
                });
            };
            mic.connect(capture);
            // Nothing is audible; the graph only runs while connected.
            const silent = context.createGain();
            silent.gain.value = 0;
            capture.connect(silent).connect(context.destination);
            setStatus("listening");
            // Let the coach speak first.
            send({
              realtimeInput: { text: "(The athlete started the check-in.)" },
            });
            s.timers.push(
              setTimeout(() => stop(), data.maxMinutes * 60000 - 15000),
            );
          } else if (e.type === "audio") play(s, e.data);
          else if (e.type === "interrupted") {
            s.sources.forEach((source) => source.stop());
            s.sources.clear();
            s.playAt = 0;
            s.lineClosed = true;
          } else if (e.type === "heard") {
            setLines((l) => appendLine(l, "you", e.text));
            s.lineClosed = true;
          } else if (e.type === "said") {
            const fresh = s.lineClosed;
            s.lineClosed = false;
            setLines((l) => appendLine(l, "coach", e.text, fresh));
          } else if (e.type === "turnComplete") s.lineClosed = true;
          else if (e.type === "toolCall")
            e.calls.forEach((call) => void handle(call, send));
          else if (e.type === "goAway")
            s.timers.push(setTimeout(() => stop(), 3000));
        }
      };
    } catch (e) {
      stop(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access is off. Allow it for this site in Settings, then try again."
          : e instanceof Error
            ? e.message
            : "Voice check-in could not start.",
      );
    }
  };

  const play = (s: Session, data: string) => {
    const samples = base64ToFloat32(data);
    const buffer = s.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = s.context.createBufferSource();
    source.buffer = buffer;
    source.connect(s.context.destination);
    s.playAt = Math.max(s.playAt, s.context.currentTime + 0.05);
    source.start(s.playAt);
    s.playAt += buffer.duration;
    s.sources.add(source);
    setStatus("speaking");
    source.onended = () => {
      s.sources.delete(source);
      if (!s.sources.size && !s.closed) setStatus("listening");
    };
  };

  const handle = async (call: FunctionCall, send: (m: object) => void) => {
    const s = session.current;
    if (call.name === "end_check_in") {
      send({
        toolResponse: {
          functionResponses: [
            { id: call.id, name: call.name, response: { result: "ended" } },
          ],
        },
      });
      // Let the goodbye finish playing before hanging up.
      const remaining = s ? Math.max(0, s.playAt - s.context.currentTime) : 0;
      s?.timers.push(setTimeout(() => stop(), remaining * 1000 + 1500));
      return;
    }
    const report = String(call.args?.report ?? "").trim();
    const topic = String(call.args?.topic ?? "other");
    let result: SaveResult;
    if (call.name !== "save_to_journal" || !report)
      result = { ok: false, detail: "Nothing to save." };
    else {
      setSaves((list) => [
        ...list,
        { id: call.id, topic, report, state: "saving" },
      ]);
      result = await onSave(report);
      setSaves((list) =>
        list.map((item) =>
          item.id === call.id
            ? {
                ...item,
                state: result.ok ? "saved" : "failed",
                detail: result.detail,
              }
            : item,
        ),
      );
    }
    send({
      toolResponse: {
        functionResponses: [
          {
            id: call.id,
            name: call.name,
            response: result.ok
              ? { result: `Saved. Coach: ${result.detail}` }
              : { error: result.detail },
          },
        ],
      },
    });
  };

  return {
    status,
    error,
    lines,
    saves,
    muted,
    toggleMute,
    start: () => void start(),
    stop: () => stop(),
  };
}

// Whether the server has a Gemini key; the entry points stay hidden otherwise.
// A plain fetch: an optional feature check must never sign the person out.
export function useVoiceEnabled(accountId: string | undefined) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!accountId) return;
    const abort = new AbortController();
    fetch("/api/voice/session", {
      headers: privateRequestHeaders({ "X-Journal-Account": accountId }),
      cache: "no-store",
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((data) => setEnabled(Boolean(data.enabled)))
      .catch(() => {});
    return () => abort.abort();
  }, [accountId]);
  return enabled;
}
