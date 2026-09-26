"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
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
  label: string;
  state: "saving" | "saved" | "failed";
  detail?: string;
};
type ActionResult =
  | { ok: true; saveId?: string; title: string; detail: string }
  | { ok: false; error: string };

const saveLabels: Record<string, string> = {
  log_training: "Training",
  log_meal: "Meal",
  log_sleep: "Sleep",
  log_activity: "Activity",
  clear_unfinished_workout: "Unfinished workout",
  set_goals: "Goals",
  undo_save: "Undo",
};
type Session = {
  socket?: WebSocket;
  context: AudioContext;
  // Live levels for the on-screen voice: the coach's output and the mic.
  output: AnalyserNode;
  input?: AnalyserNode;
  stream?: MediaStream;
  sources: Set<AudioBufferSourceNode>;
  playAt: number;
  closed: boolean;
  lineClosed: boolean;
  timers: ReturnType<typeof setTimeout>[];
  camera?: MediaStream;
  // Photos the coach has seen in this call; they may be linked to a meal.
  photos: string[];
  send?: (message: object) => void;
};

// One spoken check-in. Audio goes straight between this device and Google
// with a single-use token; each save goes to this server's journal actions.
export function useVoiceCheckin({
  accountId,
  headers,
  onSaved,
  video,
}: {
  accountId: string;
  headers: () => Record<string, string>;
  onSaved: () => void;
  // The viewfinder element photos are captured from.
  video: RefObject<HTMLVideoElement | null>;
}) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saves, setSaves] = useState<VoiceSave[]>([]);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [capturing, setCapturing] = useState(false);
  const mutedRef = useRef(false);
  const session = useRef<Session | null>(null);

  const stop = useCallback((failure?: string) => {
    const s = session.current;
    if (!s || s.closed) return;
    s.closed = true;
    s.timers.forEach(clearTimeout);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.camera?.getTracks().forEach((t) => t.stop());
    setCamera(null);
    s.sources.forEach((source) => source.stop());
    if (s.socket && s.socket.readyState <= WebSocket.OPEN) s.socket.close();
    void s.context.close();
    session.current = null;
    setError(failure ?? "");
    setStatus(failure ? "failed" : "ended");
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Who is audible right now, for drawing the voice. Null when not in a call.
  const analyser = useCallback(
    (who: "coach" | "you") =>
      (who === "coach" ? session.current?.output : session.current?.input) ??
      null,
    [],
  );

  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  };

  const start = async (purpose: "checkin" | "goals" = "checkin") => {
    if (session.current) return;
    // iOS only lets audio start from the tap itself, before any await.
    const context = new AudioContext();
    void context.resume();
    const output = context.createAnalyser();
    output.fftSize = 256;
    output.smoothingTimeConstant = 0.6;
    output.connect(context.destination);
    const s: Session = {
      context,
      output,
      sources: new Set(),
      playAt: 0,
      closed: false,
      lineClosed: true,
      timers: [],
      photos: [],
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
          purpose,
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
      s.send = send;
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
            s.input = context.createAnalyser();
            s.input.fftSize = 256;
            s.input.smoothingTimeConstant = 0.6;
            mic.connect(s.input);
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
    source.connect(s.output);
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

  const respond = (
    send: (m: object) => void,
    call: FunctionCall,
    response: object,
  ) =>
    send({
      toolResponse: {
        functionResponses: [{ id: call.id, name: call.name, response }],
      },
    });

  const closeCamera = () => {
    const s = session.current;
    s?.camera?.getTracks().forEach((t) => t.stop());
    if (s) s.camera = undefined;
    setCamera(null);
  };

  const openCamera = async () => {
    const s = session.current;
    if (!s) throw Error("The call has ended.");
    if (s.camera) return;
    s.camera = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
    });
    setCamera(s.camera);
  };

  // Captures the viewfinder, saves it as a meal photo and shows it to the
  // coach. Returns the photo id the coach links to the meal.
  const takePhoto = async () => {
    const s = session.current;
    const frame = video.current;
    if (!s?.camera || !frame?.videoWidth)
      throw Error("The camera is not open.");
    setCapturing(true);
    try {
      const scale = Math.min(
        1,
        1280 / Math.max(frame.videoWidth, frame.videoHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(frame.videoWidth * scale);
      canvas.height = Math.round(frame.videoHeight * scale);
      canvas
        .getContext("2d")!
        .drawImage(frame, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(Error("The photo could not be taken.")),
          "image/jpeg",
          0.85,
        ),
      );
      closeCamera();
      const { uploadUserImage } = await import("./food-client");
      const photo = await uploadUserImage(
        new File([blob], "meal.jpg", { type: "image/jpeg" }),
        accountId,
        localDate(),
        "Meal photo from voice check-in",
        false,
        "meal-photo",
      );
      s.photos.push(photo.id);
      const data = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      s.send?.({ realtimeInput: { video: { data, mimeType: "image/jpeg" } } });
      return photo.id;
    } finally {
      setCapturing(false);
    }
  };

  const handle = async (call: FunctionCall, send: (m: object) => void) => {
    const s = session.current;
    if (call.name === "end_check_in") {
      respond(send, call, { result: "ended" });
      // Let the goodbye finish playing before hanging up.
      const remaining = s ? Math.max(0, s.playAt - s.context.currentTime) : 0;
      s?.timers.push(setTimeout(() => stop(), remaining * 1000 + 1500));
      return;
    }
    if (call.name === "open_camera") {
      try {
        await openCamera();
        respond(send, call, {
          result:
            "The camera is open. The athlete taps the shutter, or asks you to take_photo.",
        });
      } catch (e) {
        respond(send, call, {
          error:
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "Camera access is off for this site; the athlete can describe the meal instead."
              : "The camera could not open; ask the athlete to describe the meal instead.",
        });
      }
      return;
    }
    if (call.name === "take_photo") {
      try {
        const id = await takePhoto();
        respond(send, call, {
          result: {
            photo_id: id,
            note: "The photo was sent to you as an image.",
          },
        });
      } catch (e) {
        respond(send, call, {
          error: e instanceof Error ? e.message : "The photo failed.",
        });
      }
      return;
    }
    const label = saveLabels[call.name] ?? "Save";
    setSaves((list) => [...list, { id: call.id, label, state: "saving" }]);
    let result: ActionResult;
    try {
      const response = await privateFetch("/api/voice/action", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: call.name,
          args: call.args ?? {},
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          seenPhotoIds: s?.photos ?? [],
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      result = response.ok
        ? data
        : { ok: false, error: data.error ?? "That could not be saved." };
    } catch {
      result = { ok: false, error: "The connection to the journal failed." };
    }
    setSaves((list) =>
      list.map((item) =>
        item.id === call.id
          ? {
              ...item,
              state: result.ok ? "saved" : "failed",
              detail: result.ok ? result.title : result.error,
            }
          : item,
      ),
    );
    if (result.ok) onSaved();
    respond(
      send,
      call,
      result.ok
        ? {
            result: {
              saved: result.title,
              detail: result.detail,
              ...(result.saveId ? { save_id: result.saveId } : {}),
            },
          }
        : { error: result.error },
    );
  };

  return {
    status,
    error,
    lines,
    saves,
    muted,
    toggleMute,
    start: (purpose?: "checkin" | "goals") => void start(purpose),
    stop: () => stop(),
    analyser,
    camera,
    capturing,
    closeCamera,
    // The shutter button: the coach learns the photo id from this note.
    shutter: async () => {
      try {
        const id = await takePhoto();
        session.current?.send?.({
          realtimeInput: {
            text: `(The athlete took a food photo, photo id ${id}. It is the image just sent.)`,
          },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "The photo failed.");
      }
    },
  };
}

// Whether the server has a Gemini key; the entry points stay hidden otherwise.
// A plain fetch: an optional feature check must never sign the person out.
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
