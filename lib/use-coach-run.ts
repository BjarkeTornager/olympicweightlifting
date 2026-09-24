"use client";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { privateFetch } from "./private-fetch";
import { getLocal } from "./local";
import type { ActionPreview } from "./agent/actions";
import type { JournalController } from "@/components/journal";
import type { CoachConnection } from "./use-coach-connection";
import { applyStreamUpdate, type Turn } from "./coach-turns";
import type { QueuedMessage } from "./coach-queue";

// Runs queued Coach messages strictly one at a time, in order. A failed
// message pauses the queue until it is retried (same ID, so a save is never
// repeated) or skipped.
export function useCoachRun({
  accountId,
  journal,
  connection,
  headers,
  ready,
  acting,
  setActing,
  setTurns,
  setError,
  setNotice,
}: {
  accountId: string | undefined;
  journal: JournalController;
  connection: CoachConnection | null;
  headers: () => Record<string, string>;
  // Connected, synced and not loading an image: safe to start a run.
  ready: boolean;
  // A proposal save or queue sync in progress; runs wait for it.
  acting: string | null;
  setActing: (acting: string | null) => void;
  setTurns: Dispatch<SetStateAction<Turn[]>>;
  setError: (error: string) => void;
  setNotice: (notice: string) => void;
}) {
  const activeRun = useRef<AbortController | null>(null);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [failedMessage, setFailedMessage] = useState<QueuedMessage | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backgroundResult, setBackgroundResult] = useState<
    "ready" | "failed" | null
  >(null);
  // Account changes/sign-out still unmount this controller and cancel the run.
  // Internal navigation only removes the view below, preserving work and drafts.
  useEffect(
    () => () => {
      activeRun.current?.abort();
      activeRun.current = null;
    },
    [],
  );
  const execute = async (job: QueuedMessage) => {
    const { id, question, photoIds: attachments } = job;
    const abort = new AbortController();
    activeRun.current = abort;
    setActiveId(id);
    setBusy(true);
    setBackgroundResult(null);
    setError("");
    setTurns((old) => [
      ...old.filter((t) => t.id !== id),
      { id, question, photoIds: attachments, status: "running" },
    ]);
    try {
      const { runCoach } = await import("./coach-client");
      // Read the committed local snapshot after the preceding run's fresh sync.
      // A render captured before that sync can still contain an older revision.
      const record = await getLocal(accountId!);
      abort.signal.throwIfAborted();
      if (record.dirty || record.pending || record.conflict)
        throw Error("Sync your journal changes, then retry this message.");
      const payload = {
        id,
        message: question,
        revision: record.revision,
        timezone: job.timezone,
        submittedAt: job.submittedAt,
        photoIds: attachments,
      };
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(110000),
      ]);
      const result =
        connection?.protocol === "ag-ui"
          ? await runCoach(accountId!, payload, signal, (update) => {
              if (signal.aborted) return;
              setTurns((old) =>
                old.map((t) =>
                  t.id === id ? applyStreamUpdate(t, update) : t,
                ),
              );
            })
          : await (async () => {
              // Compatibility during rolling releases; never retry a failed run
              // using a second transport, which could prepare duplicate changes.
              const r = await privateFetch("/api/agent", {
                method: "POST",
                headers: headers(),
                body: JSON.stringify(payload),
                signal,
              });
              const data = await r.json();
              if (!r.ok)
                throw Error(
                  data.error ??
                    "The assistant could not complete that request.",
                );
              return data;
            })();
      setTurns((old) =>
        old.map((t) =>
          t.id === id
            ? { id, question, photoIds: attachments, ...result, status: "done" }
            : t,
        ),
      );
      setBackgroundResult("ready");
      setFailedMessage(null);
      if (result.proposals.some((p: ActionPreview) => p.status === "saved"))
        await journal.sync(true);
    } catch (e) {
      // A dropped stream can occur after the save committed. Read the durable
      // receipt before offering a retry, and reuse this run ID if still unknown.
      if (activeRun.current !== abort) return;
      try {
        const recovered = await privateFetch(
          `/api/agent?turnId=${encodeURIComponent(id)}`,
          {
            headers: headers(),
            signal: AbortSignal.timeout(10000),
          },
        );
        const data = await recovered.json();
        if (recovered.ok && data.turn?.status === "done" && data.turn.reply) {
          setTurns((old) => old.map((t) => (t.id === id ? data.turn : t)));
          setFailedMessage(null);
          setBackgroundResult("ready");
          await journal.sync(true);
          return;
        }
      } catch {
        /* Offline: keep the same run ID to prevent duplicate saves. */
      }
      setFailedMessage(job);
      setError(
        abort.signal.aborted
          ? "Response stopped. Reconnect to check whether an entry was saved. Retrying the same message will not save it twice."
          : e instanceof Error
            ? e.message
            : "The request failed. Your journal is safe.",
      );
      setBackgroundResult("failed");
      setTurns((old) =>
        old.map((t) => (t.id === id ? { ...t, status: "failed" } : t)),
      );
      void journal.sync();
    } finally {
      if (activeRun.current === abort) {
        activeRun.current = null;
        setActiveId(null);
        setBusy(false);
      }
    }
  };
  // The effect event sees the latest account, connection and journal controller.
  // Only this drain starts requests; accepting messages never starts a parallel run.
  const drain = useEffectEvent(() => {
    if (activeRun.current || failedMessage || !ready || acting || !queue.length)
      return;
    const next = queue[0];
    setQueue((waiting) => waiting.filter((job) => job.id !== next.id));
    void execute(next);
  });
  useEffect(() => {
    const timer = setTimeout(() => drain(), 0);
    return () => clearTimeout(timer);
  }, [queue, busy, failedMessage, ready, acting]);
  useEffect(() => {
    if (!busy && !queue.length && !failedMessage) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, queue.length, failedMessage]);
  const enqueue = useCallback(
    (job: QueuedMessage) => setQueue((waiting) => [...waiting, job]),
    [],
  );
  const remove = (id: string) =>
    setQueue((waiting) => waiting.filter((job) => job.id !== id));
  const retryFailed = () => {
    if (!failedMessage || busy || !ready) return;
    setQueue((waiting) => [failedMessage, ...waiting]);
    setFailedMessage(null);
    setError("");
  };
  const skipFailed = async () => {
    if (busy || !failedMessage) return;
    setActing("queue-sync");
    await journal.sync(true);
    setFailedMessage(null);
    setActing(null);
    setError("");
    setNotice(
      "Retry skipped. Check your journal for any entry that was already saved.",
    );
  };
  return {
    queue,
    failedMessage,
    activeId,
    busy,
    backgroundResult,
    setBackgroundResult,
    enqueue,
    remove,
    retryFailed,
    skipFailed,
    stop: () => activeRun.current?.abort(),
    // A run in flight, including the moment before React re-renders busy.
    running: () => Boolean(activeRun.current),
  };
}
