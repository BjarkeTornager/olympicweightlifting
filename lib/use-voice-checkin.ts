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
  type Entry,
  type FunctionCall,
  type Receipt,
  isCreditError,
  NUDGE_AFTER_MS,
  promisesAction,
  VOICE_CREDIT_MESSAGE,
  WAITING_NUDGE,
} from "./voice-live";

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "paused"
  | "ended"
  | "failed";
export type VoicePurpose = "checkin" | "goals";
type ActionResult =
  | { ok: true; saveId?: string; title: string; detail: string }
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const saveLabels: Record<string, string> = {
  log_training: "Training",
  update_training: "Workout corrected",
  log_meal: "Meal",
  update_meal: "Meal updated",
  delete_meal: "Meal deleted",
  log_sleep: "Sleep",
  log_drink: "Drink",
  delete_drink: "Drink removed",
  log_activity: "Activity",
  clear_unfinished_workout: "Unfinished workout",
  set_goals: "Goals",
  undo_save: "Undo",
};
// Server tools that only read; they leave no receipt in the conversation.
const readTools = new Set([
  "read_journal",
  "list_photos",
  "recall_conversations",
]);
const MAX_CALL_MINUTES = 30;
// After the coach's goodbye, how long the athlete has to keep talking.
const ENDING_GRACE_MS = 12000;
// The server refuses calls from an app older than this voice protocol.
export const VOICE_CLIENT_VERSION = "3";

type Session = {
  id: string;
  purpose: VoicePurpose;
  context: AudioContext;
  // Live levels for the on-screen voice: the coach's output and the mic.
  output: AnalyserNode;
  input: AnalyserNode;
  capture?: AudioWorkletNode;
  stream?: MediaStream;
  mic?: MediaStreamAudioSourceNode;
  socket?: WebSocket;
  send?: (message: object) => void;
  // Google's resumption handle: a new connection continues the conversation.
  handle?: string;
  started: boolean;
  reconnecting: boolean;
  failures: number;
  // Checks and saves still running; the call never ends in the middle.
  pending: number;
  // The coach said goodbye; the call ends unless the athlete keeps talking.
  ending?: ReturnType<typeof setTimeout>;
  // The coach's words in the current turn, and a prompt if it stalls.
  turnText: string;
  nudge?: ReturnType<typeof setTimeout>;
  sources: Set<AudioBufferSourceNode>;
  playAt: number;
  closed: boolean;
  lineClosed: boolean;
  timers: ReturnType<typeof setTimeout>[];
  camera?: MediaStream;
  // Photos the coach has seen in this call; they may be linked to a meal.
  photos: string[];
};

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// One spoken conversation with Coach. Audio goes straight between this device
// and Google with single-use tokens; saves and reads go to this server. The
// call survives Google's connection limits, network drops and leaving the app.
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
  const [lines, setLines] = useState<Entry[]>([]);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [capturing, setCapturing] = useState(false);
  // The server refused this app version; the screen offers an update.
  const [outdated, setOutdated] = useState(false);
  const mutedRef = useRef(false);
  const session = useRef<Session | null>(null);
  const transcript = useRef<Entry[]>([]);

  // The conversation is kept on the server so Coach can recall it later.
  const persist = useCallback(
    (s: Session) => {
      const entries = transcript.current.flatMap((e) =>
        e.role === "save"
          ? []
          : [{ role: e.role, text: e.text.slice(0, 4000) }],
      );
      if (!entries.length) return;
      void privateFetch("/api/voice/transcript", {
        method: "POST",
        headers: headers(),
        keepalive: true,
        body: JSON.stringify({
          id: s.id,
          purpose: s.purpose,
          entries: entries.slice(-400),
        }),
      }).catch(() => {});
    },
    [headers],
  );

  useEffect(() => {
    transcript.current = lines;
    const s = session.current;
    if (!s) return;
    const timer = setTimeout(() => persist(s), 4000);
    return () => clearTimeout(timer);
  }, [lines, persist]);

  // Connection problems are reported (codes only, never content) so a
  // dropped call can be diagnosed on the server. A plain fetch: a report
  // must never sign the athlete out.
  const report = useCallback(
    (event: string, details: Record<string, string | number> = {}) =>
      void fetch("/api/voice/event", {
        method: "POST",
        headers: privateRequestHeaders(headers()),
        cache: "no-store",
        keepalive: true,
        body: JSON.stringify({ event, ...details }),
      }).catch(() => {}),
    [headers],
  );

  const stop = useCallback(
    (failure?: string) => {
      const s = session.current;
      if (!s || s.closed) return;
      s.closed = true;
      persist(s);
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
    },
    [persist],
  );

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

  // iOS ends the microphone when the app goes to the background; a new
  // stream is connected to the same capture graph on return.
  const ensureMic = async (s: Session) => {
    if (s.stream?.getAudioTracks().some((t) => t.readyState === "live")) return;
    s.mic?.disconnect();
    s.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    s.mic = s.context.createMediaStreamSource(s.stream);
    if (s.capture) s.mic.connect(s.capture);
    s.mic.connect(s.input);
    s.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (!s.closed && document.visibilityState === "visible")
        void ensureMic(s).catch(() => setStatus("paused"));
    });
  };

  const connect = async (s: Session, resume: boolean) => {
    const response = await privateFetch("/api/voice/session", {
      method: "POST",
      headers: { ...headers(), "X-Voice-Client": VOICE_CLIENT_VERSION },
      body: JSON.stringify({
        timezone: timezone(),
        purpose: s.purpose,
        ...(resume && s.handle ? { resumeHandle: s.handle } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (response.status === 426) setOutdated(true);
    if (!response.ok) throw Error(data.error ?? "Voice could not start.");
    if (s.closed) return;
    const previous = s.socket;
    const socket = new WebSocket(data.url);
    socket.binaryType = "arraybuffer";
    s.socket = socket;
    const send = (message: object) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(message));
    };
    await new Promise<void>((ready, fail) => {
      socket.onopen = () => send({ setup: data.setup });
      socket.onclose = (event) => {
        fail(Error(event.reason || "The voice connection closed."));
        if (!s.closed && s.socket === socket) {
          report("socket_closed", {
            code: event.code,
            reason: event.reason.slice(0, 200),
          });
          void recover(s);
        }
      };
      socket.onmessage = (event) => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        for (const e of liveEvents(raw)) {
          if (e.type === "ready") {
            s.send = send;
            s.failures = 0;
            if (previous && previous !== socket) previous.close();
            setStatus("listening");
            if (!s.started) {
              s.started = true;
              // Let the coach speak first.
              send({
                realtimeInput: { text: "(The athlete started the call.)" },
              });
            }
            ready();
          } else if (e.type === "resumeHandle") s.handle = e.handle;
          else if (e.type === "audio") play(s, e.data);
          else if (e.type === "interrupted") {
            s.sources.forEach((source) => source.stop());
            s.sources.clear();
            s.playAt = 0;
            s.lineClosed = true;
          } else if (e.type === "heard") {
            setLines((l) => appendLine(l, "you", e.text));
            s.lineClosed = true;
            clearTimeout(s.nudge);
            // Still talking after the coach's goodbye: the call goes on.
            if (s.ending) {
              clearTimeout(s.ending);
              s.ending = undefined;
            }
          } else if (e.type === "said") {
            const fresh = s.lineClosed;
            s.lineClosed = false;
            s.turnText = (fresh ? "" : s.turnText) + e.text;
            setLines((l) => appendLine(l, "coach", e.text, fresh));
          } else if (e.type === "turnComplete") {
            s.lineClosed = true;
            // "Let me check that" with nothing following would leave the
            // athlete in silence; prompt the coach to carry on.
            clearTimeout(s.nudge);
            if (promisesAction(s.turnText))
              s.nudge = setTimeout(() => {
                if (!s.pending)
                  send({ realtimeInput: { text: WAITING_NUDGE } });
              }, NUDGE_AFTER_MS);
          } else if (e.type === "toolCall") {
            clearTimeout(s.nudge);
            e.calls.forEach((call) => void handle(call, send));
          }
          // The connection is about to end: continue on a fresh one.
          else if (e.type === "goAway") {
            report("go_away");
            void recover(s);
          }
        }
      };
    });
  };

  // Reconnects with the resumption handle; the conversation carries on.
  const recover = async (s: Session) => {
    if (s.closed || s.reconnecting) return;
    if (document.visibilityState === "hidden") {
      setStatus("paused");
      return;
    }
    s.reconnecting = true;
    setStatus("reconnecting");
    // Retries for about 40 seconds: long enough to ride out a server release.
    const waits = [1000, 2000, 4000, 8000, 12000, 15000];
    try {
      while (true) {
        try {
          await ensureMic(s);
          const resumed = Boolean(s.handle);
          await connect(s, true);
          if (!resumed) {
            // Without a resumption handle the conversation starts fresh;
            // give the coach the last few lines to carry on from.
            const recent = transcript.current
              .flatMap((e) =>
                e.role === "save"
                  ? []
                  : [`${e.role === "you" ? "Athlete" : "Coach"}: ${e.text}`],
              )
              .slice(-8)
              .join("\n");
            s.send?.({
              realtimeInput: {
                text: `(The call reconnected. Continue where you left off; the last lines were:\n${recent})`,
              },
            });
          }
          report("reconnected", {
            attempts: s.failures + 1,
            resumed: Number(resumed),
          });
          return;
        } catch (e) {
          if (s.closed) return;
          const wait = waits[s.failures++];
          if (
            wait === undefined ||
            (e instanceof Error && isCreditError(e.message))
          )
            throw e instanceof Error ? e : Error("The call dropped.");
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    } catch (e) {
      report("reconnect_failed", {
        reason: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      stop(
        e instanceof Error && isCreditError(e.message)
          ? VOICE_CREDIT_MESSAGE
          : `${e instanceof Error ? e.message : "The call dropped."} Anything already saved is in Coach.`,
      );
    } finally {
      s.reconnecting = false;
    }
  };

  // Coming back to the app picks the call up again. iOS may need a tap to
  // restart audio, which the Continue button provides.
  const resumeCall = useCallback(async () => {
    const s = session.current;
    if (!s || s.closed) return;
    try {
      await s.context.resume();
      await ensureMic(s);
    } catch {
      setStatus("paused");
      return;
    }
    if (s.context.state !== "running") {
      setStatus("paused");
      return;
    }
    if (s.socket?.readyState !== WebSocket.OPEN) await recover(s);
    else setStatus("listening");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible" && session.current)
        void resumeCall();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", visible);
    };
  }, [resumeCall]);

  const start = async (purpose: VoicePurpose = "checkin") => {
    if (session.current) return;
    // iOS only lets audio start from the tap itself, before any await.
    const context = new AudioContext();
    void context.resume();
    const output = context.createAnalyser();
    output.fftSize = 256;
    output.smoothingTimeConstant = 0.6;
    output.connect(context.destination);
    const input = context.createAnalyser();
    input.fftSize = 256;
    input.smoothingTimeConstant = 0.6;
    const s: Session = {
      id: crypto.randomUUID(),
      purpose,
      context,
      output,
      input,
      started: false,
      reconnecting: false,
      failures: 0,
      pending: 0,
      turnText: "",
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
    context.onstatechange = () => {
      if (s.closed || context.state === "running") return;
      if (document.visibilityState === "visible") void resumeCall();
    };
    try {
      await context.audioWorklet.addModule("/voice-capture-worklet.js");
      s.capture = new AudioWorkletNode(context, "voice-capture");
      s.capture.port.onmessage = ({ data: pcm }) => {
        if (!mutedRef.current)
          s.send?.({
            realtimeInput: {
              audio: {
                data: pcmToBase64(pcm as ArrayBuffer),
                mimeType: "audio/pcm;rate=16000",
              },
            },
          });
      };
      // Nothing is audible; the graph only runs while connected.
      const silent = context.createGain();
      silent.gain.value = 0;
      s.capture.connect(silent).connect(context.destination);
      await ensureMic(s);
      await connect(s, false);
      // A warning lets the coach finish the topic; the call then ends at a
      // quiet moment rather than mid-sentence or mid-save.
      s.timers.push(
        setTimeout(
          () =>
            s.send?.({
              realtimeInput: {
                text: "(Two minutes left in this call: finish the current topic, then say goodbye and call end_check_in.)",
              },
            }),
          (MAX_CALL_MINUTES - 2) * 60000,
        ),
        setTimeout(() => void endWhenIdle(s, 90000), MAX_CALL_MINUTES * 60000),
      );
    } catch (e) {
      stop(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access is off. Allow it for this site in Settings, then try again."
          : e instanceof Error
            ? e.message
            : "Voice could not start.",
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
      if (!s.sources.size && !s.closed && !s.reconnecting)
        setStatus("listening");
    };
  };

  // Ends once nothing is playing and no check or save is running, or after
  // the limit if something hangs.
  const endWhenIdle = async (s: Session, limitMs: number) => {
    const until = Date.now() + limitMs;
    while (
      !s.closed &&
      Date.now() < until &&
      (s.pending > 0 ||
        s.sources.size > 0 ||
        s.playAt > s.context.currentTime + 0.1)
    )
      await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => setTimeout(r, 1200));
    stop();
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

  // Sends an image to the coach as a JPEG no larger than it needs.
  const showImage = (
    s: Session,
    source: CanvasImageSource,
    w: number,
    h: number,
  ) => {
    const scale = Math.min(1, 1024 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas
      .getContext("2d")!
      .drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    s.send?.({ realtimeInput: { video: { data, mimeType: "image/jpeg" } } });
    return canvas;
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
      const canvas = showImage(s, frame, frame.videoWidth, frame.videoHeight);
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
      return photo.id;
    } finally {
      setCapturing(false);
    }
  };

  // A saved photo, fetched privately and shown to the coach.
  const viewPhoto = async (s: Session, id: string) => {
    const response = await privateFetch(
      `/api/images/${encodeURIComponent(id)}`,
      {
        headers: { "X-Journal-Account": accountId },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw Error("That photo is not in the athlete's library.");
    const bitmap = await createImageBitmap(await response.blob());
    showImage(s, bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    if (!s.photos.includes(id)) s.photos.push(id);
  };

  const setReceipt = (id: string, state: Receipt["state"]) =>
    setLines((l) =>
      l.map((e) => (e.role === "save" && e.id === id ? { ...e, state } : e)),
    );

  const handle = async (call: FunctionCall, send: (m: object) => void) => {
    const s = session.current;
    if (!s) return;
    if (call.name === "end_check_in") {
      respond(send, call, {
        result:
          "The call ends in a few seconds unless the athlete keeps talking; if they do, carry on.",
      });
      // A premature goodbye must not cut the athlete off: the call stays
      // open briefly, and anything they say cancels the hang-up.
      if (s.ending) clearTimeout(s.ending);
      s.ending = setTimeout(() => {
        s.ending = undefined;
        void endWhenIdle(s, 30000);
      }, ENDING_GRACE_MS);
      return;
    }
    s.pending++;
    try {
      await handleTool(s, call, send);
    } finally {
      s.pending--;
    }
  };

  const handleTool = async (
    s: Session,
    call: FunctionCall,
    send: (m: object) => void,
  ) => {
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
    if (call.name === "take_photo" || call.name === "view_photo") {
      try {
        const id =
          call.name === "take_photo"
            ? await takePhoto()
            : String(call.args?.photo_id ?? "");
        if (call.name === "view_photo") await viewPhoto(s, id);
        respond(send, call, {
          result: { photo_id: id, note: "The image was sent to you." },
        });
      } catch (e) {
        respond(send, call, {
          error: e instanceof Error ? e.message : "The photo failed.",
        });
      }
      return;
    }
    const reading = readTools.has(call.name);
    if (!reading)
      setLines((l) => [
        ...l,
        {
          role: "save",
          id: call.id,
          label: saveLabels[call.name] ?? "Save",
          state: "saving",
        },
      ]);
    let result: ActionResult = {
      ok: false,
      error: "The connection to the journal failed.",
    };
    // One id for every attempt: a retry after a lost reply never saves twice.
    const id = crypto.randomUUID();
    for (const wait of [0, 1500, 3000, 6000, 10000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const response = await privateFetch("/api/voice/action", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            id,
            name: call.name,
            args: call.args ?? {},
            timezone: timezone(),
            seenPhotoIds: s.photos,
          }),
          signal: AbortSignal.timeout(20000),
        });
        // A release in progress answers 502/503; try again shortly.
        if (response.status >= 502) continue;
        const data = await response.json();
        result = response.ok
          ? data
          : { ok: false, error: data.error ?? "That could not be done." };
        break;
      } catch {
        /* Network or server restart: retry with the same id. */
      }
    }
    if (!reading) {
      setReceipt(call.id, result.ok ? "saved" : "failed");
      if (result.ok) onSaved();
    }
    respond(
      send,
      call,
      !result.ok
        ? { error: result.error }
        : "data" in result
          ? { result: result.data }
          : {
              result: {
                saved: result.title,
                detail: result.detail,
                ...(result.saveId ? { save_id: result.saveId } : {}),
              },
            },
    );
  };

  return {
    status,
    error,
    lines,
    muted,
    toggleMute,
    start: (purpose?: VoicePurpose) => void start(purpose),
    stop: () => stop(),
    resume: () => void resumeCall(),
    outdated,
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

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
