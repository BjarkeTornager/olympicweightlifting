"use client";
import { privateFetch } from "@/lib/private-fetch";
import { getLocal } from "@/lib/local";
import { useConversationScroll } from "@/lib/use-conversation-scroll";
import type { SavedVisual } from "@/lib/coach-visuals";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  Check,
  MessageCircle,
  Send,
  Sparkles,
  Undo2,
  Camera,
  Moon,
  Plus,
  Utensils,
  MoreHorizontal,
  ChevronDown,
  X,
  LoaderCircle,
  Square,
  CalendarDays,
  Table2,
} from "@/components/ui/icons";
import type { JournalController } from "./journal";
import type { ActionPreview } from "@/lib/agent/actions";
import { exerciseName, today } from "@/lib/domain";
import { uploadUserImage } from "@/lib/food-client";
import {
  imageCoachPrompt,
  sleepLoggingPrompt,
  type UserImage,
} from "@/lib/images";
import { ImageBadge } from "./image-library";
import { FoodPhotoImage } from "./food-photo";
import { MealDetails } from "./views/food";
import { formatSet } from "@/lib/training";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { CardioDetails } from "./cardio";
import { DailyOverview, CheckinDialog, CheckinDetails } from "./health";
import { AssistantText } from "./assistant-text";
import { CoachVisuals } from "./coach-visuals";
import { CoachMemoryBook } from "./coach-memory";
import { WeeklyReview } from "./weekly-review";
import { CoachEntryDetails, coachEntrySummary } from "./coach-review-details";
import { CoachOpening, CoachPreferences } from "./coach-opening";
import { LiftingVideoDialog } from "./lifting-video-upload";
import { videoFeedbackLabel } from "@/lib/lifting-video";
type Turn = {
  id: string;
  question: string;
  reply?: string;
  proposals?: ActionPreview[];
  status: string;
  photoIds?: string[];
  visuals?: SavedVisual[];
  activity?: string;
};
type QueuedMessage = {
  id: string;
  question: string;
  photoIds: string[];
  timezone: string;
  submittedAt: string;
};
const MAX_QUEUED_MESSAGES = 20;
export function TrainingAgent({
  journal,
  onLogin,
  go,
  visible,
  entryId,
  initialPhotoId,
  initialSleepLog = false,
  initialCardioLog = false,
  initialTrainingPrompt,
  initialVideoReview = false,
}: {
  journal: JournalController;
  onLogin: () => void;
  go: (r: string) => void;
  visible: boolean;
  entryId: number;
  initialPhotoId?: string;
  initialSleepLog?: boolean;
  initialCardioLog?: boolean;
  initialTrainingPrompt?: string;
  initialVideoReview?: boolean;
}) {
  const entryPrompt = initialSleepLog
    ? sleepLoggingPrompt(Boolean(initialPhotoId))
    : initialCardioLog
      ? "Help me log a cardio activity. I’ll describe what I did or attach an activity screenshot. Ask for any missing activity, date or duration, then save the entry."
      : (initialTrainingPrompt ?? "");
  const [turns, setTurns] = useState<Turn[]>([]),
    [message, setMessage] = useState(entryPrompt),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [connection, setConnection] = useState<{
      enabled: boolean;
      provider: string | null;
      protocol?: string;
    } | null>(null),
    [clear, setClear] = useState(false);
  const [acting, setActing] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const activeRun = useRef<AbortController | null>(null);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [failedMessage, setFailedMessage] = useState<QueuedMessage | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // A submitted draft cannot be accepted twice before React clears the composer.
  const submittedDraft = useRef<string | null>(null);
  const submittedVideoReviews = useRef(new Set<string>());
  // Account changes/sign-out still unmount this controller and cancel the run.
  // Internal navigation only removes the view below, preserving work and drafts.
  useEffect(
    () => () => {
      activeRun.current?.abort();
      activeRun.current = null;
    },
    [],
  );
  const [backgroundResult, setBackgroundResult] = useState<
    "ready" | "failed" | null
  >(null);
  const [view, setView] = useState<"conversation" | "today" | "week">(
    "conversation",
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(initialVideoReview);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memoryTab, setMemoryTab] = useState<"memories" | "plans">("memories");
  function openMemories(tab: "memories" | "plans" = "memories") {
    setMemoryTab(tab);
    setMemoriesOpen(true);
  }
  const [visibleCount, setVisibleCount] = useState(6);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const newestId = turns.at(-1)?.id;
  const { conversation, content, showLatest, readHistory, remember } =
    useConversationScroll(newestId, visible && view === "conversation");
  const needsReview = (proposal: ActionPreview) =>
    !proposal.status && new Date(proposal.expiresAt).getTime() > now;
  const reviewCount = turns.reduce(
    (count, turn) => count + (turn.proposals?.filter(needsReview).length ?? 0),
    0,
  );
  const draft = (text: string) => {
    submittedDraft.current = null;
    setView("conversation");
    setMessage((current) => (current.trim() ? `${current}\n\n${text}` : text));
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [imageDetails, setImageDetails] = useState<Record<string, UserImage>>(
    {},
  );
  const [loadingImage, setLoadingImage] = useState(Boolean(initialPhotoId));
  const [autoTag, setAutoTag] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [checkinDate, setCheckinDate] = useState<string | null>(null);
  const [handledEntry, setHandledEntry] = useState(entryId);
  const [wasVisible, setWasVisible] = useState(visible);
  // Apply a navigation intent once without discarding an existing draft or run.
  if (handledEntry !== entryId) {
    setHandledEntry(entryId);
    setLoadingImage(Boolean(initialPhotoId));
    if (initialVideoReview) setVideoOpen(true);
    if (entryPrompt) {
      setView("conversation");
      setMessage((current) =>
        current.trim() && current !== entryPrompt
          ? `${current}\n\n${entryPrompt}`
          : entryPrompt,
      );
    } else if (initialPhotoId) setView("conversation");
  }
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setVideoOpen(false);
      setOptionsOpen(false);
      setMemoriesOpen(false);
      setClear(false);
      setCheckinDate(null);
    }
  }
  if (visible && backgroundResult) setBackgroundResult(null);
  const accountId = journal.identity?.id;
  useEffect(() => {
    if (!initialPhotoId || !accountId) return;
    const abort = new AbortController();
    privateFetch(
      `/api/images/${encodeURIComponent(initialPhotoId)}?metadata=1`,
      {
        headers: { "X-Journal-Account": accountId },
        cache: "no-store",
        signal: abort.signal,
      },
    )
      .then(async (r) => {
        const image: UserImage & { error?: string } = await r.json();
        if (!r.ok) throw Error(image.error ?? "Image unavailable.");
        if (!abort.signal.aborted) {
          submittedDraft.current = null;
          setPhotoIds((ids) => [...new Set([...ids, image.id])]);
          setImageDetails((details) => ({ ...details, [image.id]: image }));
          setMessage((current) => current || imageCoachPrompt(image.category));
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingImage(false);
      });
    return () => abort.abort();
  }, [entryId, initialPhotoId, accountId]);
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "X-Journal-Account": accountId ?? "",
    }),
    [accountId],
  );
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const connectionRequest = useRef<AbortController | null>(null);
  const connectionReady = useRef(false);
  const refresh = useCallback(async () => {
    if (!accountId || connectionRequest.current) return;
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnectionLoading(true);
    setConnectionError("");
    try {
      const r = await privateFetch("/api/agent", {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      const data = await r.json();
      if (!r.ok) throw Error("Coach couldn’t connect. Please try again.");
      controller.signal.throwIfAborted();
      connectionReady.current = Boolean(data.enabled);
      setConnection({
        enabled: data.enabled,
        provider: data.provider,
        protocol: data.protocol,
      });
      setTurns((current) => [
        ...data.turns.filter((t: Turn) => !current.some((v) => v.id === t.id)),
        ...current,
      ]);
    } catch {
      if (!controller.signal.aborted) {
        connectionReady.current = false;
        setConnectionError("Coach couldn’t connect. Your draft is still here.");
      }
    } finally {
      if (connectionRequest.current === controller) {
        connectionRequest.current = null;
        if (!controller.signal.aborted) setConnectionLoading(false);
      }
    }
  }, [accountId, headers]);
  useEffect(() => {
    const retry = () => {
      if (!connectionReady.current && document.visibilityState === "visible")
        void refresh();
    };
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(retry, 15000);
    window.addEventListener("online", retry);
    window.addEventListener("pageshow", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      connectionRequest.current?.abort();
      connectionRequest.current = null;
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("online", retry);
      window.removeEventListener("pageshow", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [refresh]);
  const pending = Boolean(
    journal.record?.dirty ||
    journal.record?.pending ||
    journal.record?.conflict,
  );
  const ready = Boolean(
    accountId &&
    connection?.enabled &&
    !pending &&
    !loadingImage &&
    journal.status === "synced",
  );
  const reconnecting = connectionLoading || journal.status === "syncing";
  const connectionHint = journal.record?.conflict
    ? "Choose which journal version to keep before messaging Coach."
    : pending
      ? "Sync your pending changes before messaging Coach. Your draft is still here."
      : journal.status === "offline"
        ? "You’re offline. Reconnect to send your message. Your draft is still here."
        : journal.status !== "synced"
          ? "Your journal hasn’t connected yet. Reconnect to send your message."
          : connectionError
            ? connectionError
            : connectionLoading
              ? "Connecting to Coach… Your draft is still here."
              : !connection?.enabled
                ? "Coach is temporarily unavailable. Try reconnecting in a moment."
                : loadingImage
                  ? "Loading your attached image…"
                  : "";
  const reconnect = () => {
    // Recheck independently: neither failure should prevent the other recovery.
    // Never submit the draft or save a proposal as a side effect of reconnecting.
    void journal.sync();
    if (!connectionReady.current) void refresh();
  };
  const attach = async (file?: File) => {
    if (!file || !accountId || photoIds.length >= 4) return;
    submittedDraft.current = null;
    setUploading(true);
    setError("");
    try {
      const photo = await uploadUserImage(
        file,
        accountId,
        today(),
        "Uploaded image",
        autoTag,
      );
      setPhotoIds((ids) => [...ids, photo.id]);
      setImageDetails((old) => ({ ...old, [photo.id]: photo }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  };
  const send = (provided?: string) => {
    const question =
      provided?.trim() ||
      message.trim() ||
      (photoIds.length
        ? imageCoachPrompt(
            photoIds.every((id) => imageDetails[id]?.category === "food")
              ? "food"
              : photoIds.every((id) => imageDetails[id]?.category === "sleep")
                ? "sleep"
                : "unclassified",
          )
        : "");
    if (!question || uploading || !ready || photoIds.length > 4) return;
    if (queue.length >= MAX_QUEUED_MESSAGES) {
      setError(
        "Your queue is full. Let Coach finish a message or remove a queued message.",
      );
      return;
    }
    const signature = JSON.stringify([question, photoIds]);
    if (submittedDraft.current === signature) return;
    submittedDraft.current = signature;
    const job: QueuedMessage = {
      id: crypto.randomUUID(),
      question,
      photoIds: [...photoIds],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      submittedAt: new Date().toISOString(),
    };
    setQueue((waiting) => [...waiting, job]);
    setMessage("");
    setPhotoIds([]);
    setImageDetails({});
    setView("conversation");
    setToolsOpen(false);
    if (!failedMessage) setError("");
    // Keep keyboard focus so another message can follow immediately.
    input.current?.focus({ preventScroll: true });
  };
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
      const { runCoach } = await import("@/lib/coach-client");
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
                  t.id === id
                    ? {
                        ...t,
                        ...(update.reply !== undefined
                          ? { reply: update.reply }
                          : {}),
                        ...(update.activity
                          ? { activity: update.activity }
                          : {}),
                        ...(update.visual
                          ? {
                              visuals: [
                                ...(t.visuals ?? []).filter(
                                  (v) => v.id !== update.visual!.id,
                                ),
                                update.visual,
                              ].slice(0, 3),
                            }
                          : {}),
                      }
                    : t,
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
  const apply = async (p: ActionPreview, undo = false) => {
    if (pending || acting || activeRun.current) return;
    setActing(p.id);
    setError("");
    setNotice("");
    try {
      const r = await privateFetch("/api/agent/action", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id: p.id, undo }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error ?? "Could not save this change.");
      setTurns((old) =>
        old.map((t) => ({
          ...t,
          ...(undo && t.proposals?.some((v) => v.id === p.id && v.automatic)
            ? {
                reply:
                  "Undone. Your journal has been restored to before this change.",
              }
            : {}),
          proposals: t.proposals?.map((v) =>
            v.id === p.id ? { ...v, status: data.status } : v,
          ),
        })),
      );
      await journal.sync(true);
      setNotice(
        undo
          ? "Change undone and saved to your account."
          : "Saved to your account.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save this change. Retry to check its status.",
      );
    } finally {
      setActing(null);
    }
  };
  const ask = (question: string) => {
    if (!accountId) {
      onLogin();
      return;
    }
    setView("conversation");
    if (message.trim() || photoIds.length) {
      draft(question);
      return;
    }
    submittedDraft.current = null;
    setMessage(question);
    if (ready) void send(question);
    else {
      input.current?.focus({ preventScroll: true });
      setError(
        pending
          ? "Sync your journal first so Coach can use your latest entries."
          : "Connect your assistant and sync your journal to build a personalised plan.",
      );
    }
  };
  if (!visible) {
    const status = failedMessage
      ? "Coach needs your attention"
      : busy
        ? queue.length
          ? `Coach is working… ${queue.length} queued`
          : "Coach is working…"
        : queue.length
          ? `${queue.length} messages waiting for Coach`
          : acting
            ? "Coach is saving your change…"
            : uploading || loadingImage
              ? "Coach is preparing your photo…"
              : backgroundResult === "ready"
                ? "Your Coach reply is ready"
                : backgroundResult === "failed"
                  ? "Coach needs your attention"
                  : null;
    return status ? (
      <div className="coach-background-status">
        <span role="status">
          {busy || acting || uploading || loadingImage ? (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={18} aria-hidden="true" />
          )}
          {status}
        </span>
        <a
          href="#coach"
          onClick={() => {
            setView("conversation");
            showLatest();
          }}
        >
          Open Coach <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    ) : null;
  }
  const opening =
    connection?.enabled &&
    journal.status === "synced" &&
    !pending &&
    !initialPhotoId &&
    !initialSleepLog &&
    !initialCardioLog ? (
      <CoachOpening
        key={`${accountId}:${today()}`}
        journal={journal}
        date={today()}
        compact={turns.length > 0}
        disabled={busy || Boolean(acting) || uploading}
        onDiscuss={ask}
      />
    ) : null;
  return (
    <div className="agent-page">
      <header className="coach-header">
        <div className="coach-title">
          <span className="coach-avatar" aria-hidden="true">
            <Sparkles size={25} weight="duotone" />
          </span>
          <div>
            <h1>Coach</h1>
            <p>Your training, nutrition & recovery</p>
          </div>
          <Button
            variant="ghost"
            aria-label="Coach options"
            onClick={() => setOptionsOpen(true)}
          >
            <MoreHorizontal size={22} />
          </Button>
        </div>
        <div className="coach-navigation">
          <nav aria-label="Coach views" className="coach-view-switch">
            <button
              aria-pressed={view === "conversation"}
              onClick={() => setView("conversation")}
            >
              Conversation
            </button>
            <button
              aria-pressed={view === "today"}
              onClick={() => setView("today")}
            >
              Today
            </button>
            <button
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              Week
            </button>
          </nav>
          <span className={`coach-connection ${ready ? "connected" : ""}`}>
            {ready
              ? "Ready to help"
              : journal.record?.conflict
                ? "Sync needs attention"
                : pending
                  ? "Changes waiting to sync"
                  : loadingImage
                    ? "Loading image…"
                    : reconnecting
                      ? "Connecting…"
                      : "Connection interrupted"}
          </span>
        </div>
      </header>
      <div className="coach-today" hidden={view !== "today"}>
        {view === "today" && (
          <DailyOverview
            journal={journal}
            onMemories={(plans) => openMemories(plans ? "plans" : "memories")}
            onCheckin={() => setCheckinDate(today())}
            onAsk={ask}
            go={go}
            busy={busy || Boolean(acting) || uploading}
          />
        )}
      </div>
      <div className="coach-week" hidden={view !== "week"}>
        {view === "week" && (
          <WeeklyReview
            journal={journal}
            onAsk={ask}
            busy={busy || Boolean(acting) || uploading}
          />
        )}
      </div>
      <CheckinDialog
        journal={journal}
        date={checkinDate}
        onClose={() => setCheckinDate(null)}
      />
      <section
        className="coach-workspace"
        hidden={view !== "conversation"}
        aria-label="Coach conversation workspace"
      >
        {!accountId ? (
          <section className="panel agent-welcome">
            <MessageCircle size={28} />
            <h3>Your next step starts here.</h3>
            <p>
              Sign in to connect your health, food and training history with
              Coach. Reported entries are saved with Undo.
            </p>
            <Button onClick={onLogin}>Sign in to talk with Coach</Button>
            <p className="fine-print">
              Your daily check-in and manual logging also work on this device.
            </p>
          </section>
        ) : (
          <>
            {turns.length > 0 && opening}
            {(turns.length > 1 || reviewCount > 0) && (
              <div className="coach-thread-tools">
                {reviewCount > 0 ? (
                  <button
                    className="coach-review-jump"
                    onClick={() => {
                      readHistory();
                      const index = turns.findIndex((turn) =>
                        turn.proposals?.some(needsReview),
                      );
                      setVisibleCount((count) =>
                        Math.max(count, turns.length - index),
                      );
                      requestAnimationFrame(() => {
                        const proposal =
                          conversation.current?.querySelector<HTMLElement>(
                            '[data-needs-review="true"]',
                          );
                        if (proposal && conversation.current) {
                          const scroller = conversation.current;
                          const details = proposal.querySelector("details");
                          if (details) details.open = true;
                          scroller.scrollTop +=
                            proposal.getBoundingClientRect().top -
                            scroller.getBoundingClientRect().top -
                            16;
                          proposal
                            .querySelector<HTMLElement>("summary")
                            ?.focus({ preventScroll: true });
                        }
                      });
                    }}
                  >
                    Review ({reviewCount})
                  </button>
                ) : (
                  <span>Recent conversation</span>
                )}
                <button onClick={showLatest}>
                  Latest message <ChevronDown size={14} />
                </button>
              </div>
            )}
            <div
              className="conversation"
              ref={conversation}
              role="log"
              id="coach-conversation"
              tabIndex={0}
              aria-label="Coach conversation"
              aria-busy={busy}
              onScroll={remember}
              onWheel={readHistory}
              onTouchMove={readHistory}
              onPointerDown={readHistory}
              onKeyDown={(event) => {
                if (
                  [
                    "ArrowUp",
                    "ArrowDown",
                    "PageUp",
                    "PageDown",
                    "Home",
                    "End",
                    " ",
                  ].includes(event.key)
                )
                  readHistory();
              }}
            >
              <div className="conversation-content" ref={content}>
                {!turns.length && (
                  <div className="coach-start">
                    <h2>What’s on your mind today?</h2>
                    <p>
                      We can think it through together, or simply record what
                      you want to remember.
                    </p>
                    {opening}
                    <div className="agent-prompts">
                      {[
                        {
                          text: "Help me think through my week",
                          icon: CalendarDays,
                        },
                        { text: "Show my week in a table", icon: Table2 },
                      ].map(({ text, icon: Icon }) => (
                        <button
                          key={text}
                          disabled={busy}
                          onClick={() => ask(text)}
                        >
                          <Icon size={24} weight="duotone" aria-hidden="true" />
                          <span>{text}</span>
                          <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {turns.length > visibleCount && (
                  <Button
                    variant="ghost"
                    className="coach-older"
                    onClick={() => {
                      readHistory();
                      const scroller = conversation.current;
                      const height = scroller?.scrollHeight ?? 0;
                      const top = scroller?.scrollTop ?? 0;
                      setVisibleCount((count) => count + 10);
                      requestAnimationFrame(() => {
                        if (scroller)
                          scroller.scrollTop =
                            top + scroller.scrollHeight - height;
                      });
                    }}
                  >
                    Earlier messages ({turns.length - visibleCount})
                  </Button>
                )}
                {turns.slice(-visibleCount).map((t) => (
                  <article className="conversation-turn" key={t.id}>
                    <div className="chat-user">
                      <span className="sr-only">You: </span>
                      {videoFeedbackLabel(
                        t.question,
                        t.photoIds?.length ?? 0,
                      ) ?? t.question}
                      {accountId && (
                        <div className="food-photo-strip">
                          {t.photoIds?.map((id) => (
                            <FoodPhotoImage
                              key={`${accountId}:${id}`}
                              id={id}
                              accountId={accountId}
                              label="Attached image"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    {(t.reply || Boolean(t.visuals?.length)) && (
                      <div className="chat-assistant">
                        <span className="assistant-mark">
                          <Sparkles size={16} /> Lift Journal
                        </span>
                        {t.reply && <AssistantText text={t.reply} />}
                        {Boolean(t.visuals?.length) && (
                          <CoachVisuals
                            visuals={t.visuals!}
                            accountId={accountId}
                          />
                        )}
                      </div>
                    )}
                    {t.status === "running" && (
                      <div className="coach-run-activity">
                        <p role="status">
                          {busy && t.id === activeId && (
                            <LoaderCircle size={15} aria-hidden="true" />
                          )}
                          {busy && t.id === activeId
                            ? (t.activity ?? "Looking through your journal…")
                            : "This request has not completed. You can ask again."}
                        </p>
                        {busy && t.id === activeId && (
                          <button
                            onClick={() => activeRun.current?.abort()}
                            aria-label="Stop response"
                          >
                            <Square size={12} aria-hidden="true" />
                            Stop
                          </button>
                        )}
                      </div>
                    )}
                    {t.status === "failed" && (
                      <p className="fine-print">
                        This reply was interrupted. Reconnect to check its saved
                        status.
                      </p>
                    )}
                    {t.proposals?.map((p) => (
                      <section
                        key={p.id}
                        className={`agent-proposal ${p.status ?? "pending"}`}
                        aria-label={
                          p.status === "saved" && p.automatic
                            ? "Saved journal entry"
                            : "Review journal change"
                        }
                        data-needs-review={needsReview(p)}
                      >
                        <details
                          key={`${p.id}-${p.status ?? "pending"}`}
                          open={p.status ? undefined : true}
                        >
                          <summary className="proposal-summary">
                            <span className="eyebrow">
                              {p.status === "saved"
                                ? "SAVED"
                                : p.status === "undone"
                                  ? "UNDONE"
                                  : "REVIEW BEFORE SAVING"}
                            </span>
                            <h2>{p.title}</h2>
                            <ChevronDown size={18} aria-hidden="true" />
                          </summary>
                          <div className="proposal-body">
                            <p>{p.detail}</p>
                            {p.entries && (
                              <div className="coach-bundle">
                                {p.entries.map((entry, i) => (
                                  <details
                                    key={i}
                                    className="coach-bundle-entry"
                                  >
                                    <summary>
                                      <span>
                                        {String(i + 1).padStart(2, "0")}
                                      </span>
                                      <div>
                                        <strong>
                                          {entry.meal
                                            ? `${entry.meal.name} · ${entry.meal.type}`
                                            : entry.checkin
                                              ? `${entry.title} · ${entry.checkin.date}`
                                              : entry.cardio
                                                ? entry.title
                                                : (entry.workout?.title ??
                                                  entry.title)}
                                        </strong>
                                        <small>
                                          {coachEntrySummary(entry)}
                                        </small>
                                      </div>
                                      <ChevronDown size={16} />
                                    </summary>
                                    <div>
                                      <p className="fine-print">
                                        {entry.detail}
                                      </p>
                                      <CoachEntryDetails entry={entry} />
                                    </div>
                                  </details>
                                ))}
                              </div>
                            )}
                            {(p.memory ||
                              p.plan ||
                              p.training ||
                              p.liftingBrief !== undefined) && (
                              <CoachEntryDetails
                                entry={{
                                  title: p.title,
                                  detail: p.detail,
                                  workout: null,
                                  memory: p.memory,
                                  plan: p.plan,
                                  training: p.training,
                                  liftingBrief: p.liftingBrief,
                                }}
                              />
                            )}
                            {p.cardio && <CardioDetails entry={p.cardio} />}
                            {p.checkin && (
                              <>
                                <p className="proposal-date">
                                  Check-in · {p.checkin.date}
                                </p>
                                <CheckinDetails checkin={p.checkin} />
                              </>
                            )}
                            {p.meal && <MealDetails meal={p.meal} />}
                            {p.targets && (
                              <div className="meal-details">
                                <p>Goal: {p.targets.goal} weight</p>
                                {(
                                  [
                                    "calories",
                                    "protein",
                                    "carbs",
                                    "fat",
                                  ] as const
                                ).map((key) => (
                                  <p key={key}>
                                    {key}: {p.targets![key] ?? "No target"}
                                    {p.targets![key] != null
                                      ? key === "calories"
                                        ? " kcal"
                                        : " g"
                                      : ""}
                                  </p>
                                ))}
                              </div>
                            )}
                            {p.workout && (
                              <>
                                <div className="proposal-date">
                                  <strong>{p.workout.title}</strong>
                                  <span>{p.workout.date}</span>
                                </div>
                                {p.workoutReview && (
                                  <p className="workout-review-status">
                                    <strong>
                                      {p.workoutReview.status === "ongoing"
                                        ? "Ongoing · continue in Train"
                                        : "Completed · training history"}
                                    </strong>
                                  </p>
                                )}
                                {p.workoutReview?.sources && (
                                  <div className="workout-merge-sources">
                                    <strong>Entries being combined</strong>
                                    <ul>
                                      {p.workoutReview.sources.map((source) => (
                                        <li key={source.id}>
                                          {source.title} · {source.date} ·{" "}
                                          {source.sets} sets
                                        </li>
                                      ))}
                                    </ul>
                                    <p>
                                      All sets and notes are retained. These
                                      entries become one workout.
                                    </p>
                                  </div>
                                )}
                                {p.workout.exercises.map((e) => (
                                  <div className="proposal-exercise" key={e.id}>
                                    <h3>{exerciseName(e.exerciseId)}</h3>
                                    <div className="set-chips">
                                      {e.sets.map((s) => (
                                        <span key={s.id}>
                                          {formatSet(s.weight, s.reps)}
                                          {s.result === "miss"
                                            ? " · miss"
                                            : s.result
                                              ? " · made"
                                              : " · planned"}
                                          {s.rpe ? ` · RPE ${s.rpe}` : ""}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {p.workout.athleteNotes && (
                                  <p>{p.workout.athleteNotes}</p>
                                )}
                              </>
                            )}
                            <div className="button-row">
                              {!p.status && (
                                <Button
                                  disabled={
                                    !ready ||
                                    Boolean(acting) ||
                                    busy ||
                                    new Date(p.expiresAt).getTime() < now
                                  }
                                  onClick={() => void apply(p)}
                                >
                                  <Check size={17} />
                                  {acting === p.id
                                    ? "Saving…"
                                    : p.entries
                                      ? `Save all ${p.entries.length} entries`
                                      : "Save this change"}
                                </Button>
                              )}
                              {p.status === "saved" && !p.automatic && (
                                <Button
                                  variant="secondary"
                                  disabled={pending || Boolean(acting) || busy}
                                  onClick={() => void apply(p, true)}
                                >
                                  <Undo2 size={17} />
                                  {p.entries
                                    ? "Undo all entries"
                                    : "Undo this change"}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  p.memory || p.plan
                                    ? openMemories(
                                        p.plan ? "plans" : "memories",
                                      )
                                    : p.entries
                                      ? setView("today")
                                      : go(
                                          p.liftingBrief !== undefined
                                            ? "workout/coaching"
                                            : p.training
                                              ? "workout/choose"
                                              : p.cardio
                                                ? "cardio"
                                                : p.checkin
                                                  ? "health"
                                                  : p.meal || p.targets
                                                    ? "food"
                                                    : p.workoutReview
                                                      ? p.workoutReview
                                                          .status === "ongoing"
                                                        ? "workout"
                                                        : "history"
                                                      : p.workout &&
                                                          p.workout.exercises.some(
                                                            (e) =>
                                                              e.sets.some(
                                                                (s) =>
                                                                  !s.result,
                                                              ),
                                                          )
                                                        ? "workout"
                                                        : "history",
                                        )
                                }
                              >
                                {p.liftingBrief !== undefined
                                  ? "Open lifting coach"
                                  : p.training
                                    ? "Open Train"
                                    : p.workoutReview?.status === "ongoing"
                                      ? "Open ongoing workout"
                                      : p.workoutReview
                                        ? "Open training history"
                                        : "Open journal"}{" "}
                                <ArrowRight size={17} />
                              </Button>
                            </div>
                            <p className="fine-print">
                              {p.status
                                ? "Undo is available for 24 hours while no later journal change has been saved."
                                : `Proposal expires ${new Date(p.expiresAt).toLocaleString()}. A newer journal change requires a fresh proposal.`}
                            </p>
                          </div>
                        </details>
                        {p.status === "saved" && p.automatic && (
                          <div className="button-row coach-saved-actions">
                            <span className="fine-print">
                              Saved to your account
                            </span>
                            <Button
                              variant="ghost"
                              disabled={
                                pending ||
                                Boolean(acting) ||
                                busy ||
                                new Date(p.expiresAt).getTime() < now
                              }
                              onClick={() => void apply(p, true)}
                            >
                              <Undo2 size={17} />
                              {acting === p.id
                                ? "Undoing…"
                                : p.entries
                                  ? "Undo all entries"
                                  : "Undo"}
                            </Button>
                          </div>
                        )}
                        {p.status === "saved" && p.workoutReview && (
                          <Button
                            className="saved-workout-link"
                            variant="ghost"
                            onClick={() =>
                              go(
                                p.workoutReview!.status === "ongoing"
                                  ? "workout"
                                  : "history",
                              )
                            }
                          >
                            {p.workoutReview.status === "ongoing"
                              ? "Continue workout"
                              : "View training history"}{" "}
                            <ArrowRight size={17} />
                          </Button>
                        )}
                      </section>
                    ))}
                  </article>
                ))}
              </div>
            </div>

            {(queue.length > 0 || failedMessage) && (
              <section className="coach-queue" aria-label="Message queue">
                <details open={failedMessage ? true : undefined}>
                  <summary>
                    <span role="status">
                      {failedMessage
                        ? "Queue paused"
                        : `${queue.length} queued`}
                    </span>
                    <span>
                      View messages <ChevronDown size={14} />
                    </span>
                  </summary>
                  <p>
                    <span>
                      {failedMessage
                        ? "Retry the interrupted message or skip it to continue."
                        : queue.length >= MAX_QUEUED_MESSAGES
                          ? "Your queue is full. Remove a message or let Coach catch up."
                          : "Coach will reply in order. Keep this tab open; you can explore the site."}
                    </span>
                  </p>
                  {failedMessage && (
                    <div className="coach-queue-failed">
                      <p>
                        {videoFeedbackLabel(
                          failedMessage.question,
                          failedMessage.photoIds.length,
                        ) ?? failedMessage.question}
                      </p>
                      <div>
                        <Button
                          variant="secondary"
                          disabled={busy || !ready || Boolean(acting)}
                          onClick={retryFailed}
                        >
                          Retry message
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || !ready || Boolean(acting)}
                          onClick={() => void skipFailed()}
                        >
                          Skip and continue
                        </Button>
                      </div>
                    </div>
                  )}
                  {queue.length > 0 && (
                    <ol>
                      {queue.map((job, index) => (
                        <li key={job.id}>
                          <span>
                            <strong>{index + 1}.</strong>{" "}
                            {videoFeedbackLabel(
                              job.question,
                              job.photoIds.length,
                            ) ?? job.question}
                            {job.photoIds.length > 0 && (
                              <small>
                                {" "}
                                · {job.photoIds.length} attached{" "}
                                {job.photoIds.length === 1 ? "image" : "images"}
                              </small>
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            aria-label={`Remove queued message ${index + 1}`}
                            onClick={() =>
                              setQueue((waiting) =>
                                waiting.filter((item) => item.id !== job.id),
                              )
                            }
                          >
                            <X size={16} />
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}
                </details>
              </section>
            )}
            {error && (
              <div className="notice warning" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}
            <form
              className="agent-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="training-message">
                Message your coach
              </label>
              <textarea
                id="training-message"
                ref={input}
                value={message}
                maxLength={6000}
                rows={2}
                enterKeyHint="send"
                aria-describedby="coach-message-keyboard-hint"
                onChange={(e) => {
                  submittedDraft.current = null;
                  setMessage(e.target.value);
                }}
                placeholder="Ask anything, or tell me about your day…"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229
                  ) {
                    e.preventDefault();
                    if (!e.repeat) void send();
                  }
                }}
              />
              <span id="coach-message-keyboard-hint" className="sr-only">
                Press Enter to send. Use Shift+Enter for a new line.
              </span>
              <div className="composer-actions">
                <div className="composer-quick-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Add images"
                    aria-expanded={toolsOpen}
                    aria-controls="coach-image-tools"
                    onClick={() => setToolsOpen((open) => !open)}
                  >
                    <Plus size={20} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={uploading || loadingImage}
                    onClick={() =>
                      draft(
                        "Help me log what I ate. Ask for materially missing details, then save the entry.",
                      )
                    }
                  >
                    <Utensils size={16} /> <span>Log food</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={uploading || loadingImage}
                    onClick={() =>
                      draft(
                        message.trim()
                          ? "Please use this to log my sleep. Ask about any unclear date or time asleep and save the entry."
                          : sleepLoggingPrompt(photoIds.length > 0),
                      )
                    }
                  >
                    <Moon size={16} /> <span>Log sleep</span>
                  </Button>
                </div>
                <Button
                  type="submit"
                  disabled={
                    !ready ||
                    uploading ||
                    queue.length >= MAX_QUEUED_MESSAGES ||
                    photoIds.length > 4 ||
                    (!message.trim() && !photoIds.length)
                  }
                >
                  <Send size={17} />
                  Send
                </Button>
              </div>
              <div
                id="coach-image-tools"
                className="coach-image-tools"
                hidden={!toolsOpen}
              >
                <div className="food-attachments">
                  <label className="food-upload">
                    <Camera size={17} />{" "}
                    {uploading ? "Saving & tagging…" : "Take photo"}
                    <input
                      type="file"
                      aria-label="Take photo"
                      accept="image/*"
                      capture="environment"
                      disabled={
                        uploading ||
                        loadingImage ||
                        !accountId ||
                        photoIds.length >= 4
                      }
                      onChange={(e) => {
                        void attach(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label className="food-upload">
                    Attach image
                    <input
                      type="file"
                      aria-label="Attach image"
                      accept="image/*"
                      disabled={
                        uploading ||
                        loadingImage ||
                        !accountId ||
                        photoIds.length >= 4
                      }
                      onChange={(e) => {
                        void attach(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <a href="#images">Image library & categories</a>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!accountId || uploading || loadingImage}
                    onClick={() => setVideoOpen(true)}
                  >
                    Review lifting video
                  </Button>
                </div>
                <label className="image-auto-tag">
                  <input
                    type="checkbox"
                    checked={autoTag}
                    disabled={uploading}
                    onChange={(e) => setAutoTag(e.target.checked)}
                  />{" "}
                  Tag uploads automatically
                </label>
                <p className="fine-print">
                  Automatic tagging sends each new image to{" "}
                  {connection?.provider ?? "your configured assistant provider"}{" "}
                  to identify food, sleep, activity or other content. Turn it
                  off to save in Needs review. No journal entry is created by
                  tagging.
                </p>
              </div>
              {photoIds.length > 0 && accountId && (
                <>
                  {photoIds.length > 4 && (
                    <p className="error-text" role="alert">
                      Choose up to four photos for this message. Remove an
                      attachment to send.
                    </p>
                  )}
                  <div className="coach-attachment-strip">
                    {photoIds.map((id) => (
                      <div key={id}>
                        <FoodPhotoImage
                          id={id}
                          accountId={accountId}
                          label="Image ready to send"
                        />
                        {imageDetails[id] && (
                          <ImageBadge image={imageDetails[id]} />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="Remove attachment"
                          onClick={() =>
                            setPhotoIds((ids) => ids.filter((v) => v !== id))
                          }
                        >
                          <X size={16} />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="fine-print">
                    Attached images are shared with{" "}
                    {connection?.provider ?? "your assistant provider"} when you
                    send. Copies stay in your{" "}
                    <a href="#images">private image library</a>.
                  </p>
                </>
              )}
              {!ready && (
                <div className="coach-reconnect" role="status">
                  <p className="fine-print">{connectionHint}</p>
                  {journal.error && (
                    <p className="fine-print">{journal.error}</p>
                  )}
                  {!loadingImage && !journal.record?.conflict && (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={reconnecting}
                      onClick={reconnect}
                    >
                      {reconnecting ? "Reconnecting…" : "Reconnect Coach"}
                    </Button>
                  )}
                </div>
              )}
            </form>
            <p className="coach-composer-note">
              Reported entries are saved with Undo.{" "}
              <button onClick={() => setOptionsOpen(true)}>
                Privacy & details
              </button>
            </p>
          </>
        )}
      </section>
      {videoOpen && accountId && (
        <LiftingVideoDialog
          key={accountId}
          accountId={accountId}
          reviewBlockedReason={
            !ready
              ? connectionHint
              : queue.length >= MAX_QUEUED_MESSAGES
                ? "Your queue is full. Let Coach finish a message or remove a queued message."
                : undefined
          }
          onClose={() => setVideoOpen(false)}
          onReview={(photos, prompt) => {
            // Use the stable first sheet ID across upload/submission retries.
            // Video reviews are separate queue jobs, never the unsent draft.
            const id = photos[0].id;
            if (submittedVideoReviews.current.has(id)) return;
            // A preceding run can start syncing during the uploads. Accept the
            // authorized review; the shared drain waits for fresh synced data.
            if (queue.length >= MAX_QUEUED_MESSAGES)
              throw Error(
                "Your queue is full. Let Coach finish a message first.",
              );
            submittedVideoReviews.current.add(id);
            setQueue((waiting) => [
              ...waiting,
              {
                id,
                question: prompt,
                photoIds: photos.map((photo) => photo.id),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                submittedAt: new Date().toISOString(),
              },
            ]);
            setView("conversation");
            setToolsOpen(false);
            setVideoOpen(false);
            setNotice("Video feedback queued. Your chat draft has been kept.");
          }}
        />
      )}
      <Dialog
        open={memoriesOpen}
        onOpenChange={setMemoriesOpen}
        title={
          memoryTab === "plans" ? "Your agreed plans" : "What Coach remembers"
        }
      >
        <CoachMemoryBook
          key={memoryTab}
          initialTab={memoryTab}
          journal={journal}
          disabled={
            busy || Boolean(acting) || Boolean(journal.record?.conflict)
          }
        />
      </Dialog>
      <Dialog
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        title="Coach options"
      >
        <div className="coach-options">
          <Button
            variant="secondary"
            onClick={() => {
              setOptionsOpen(false);
              openMemories();
            }}
          >
            What Coach remembers & agreed plans <ArrowRight size={17} />
          </Button>
          <CoachPreferences
            key={`${accountId}:${optionsOpen}`}
            journal={journal}
            disabled={
              busy || Boolean(acting) || Boolean(journal.record?.conflict)
            }
          />
          <Button variant="secondary" onClick={() => go("cardio")}>
            Cardio & movement <ArrowRight size={17} />
          </Button>
          <Button variant="secondary" onClick={() => go("health")}>
            Health history <ArrowRight size={17} />
          </Button>
          <Button variant="secondary" onClick={() => go("images")}>
            Image library & categories <ArrowRight size={17} />
          </Button>
          <Button variant="secondary" onClick={() => go("workout/coaching")}>
            Lifting coach <ArrowRight size={17} />
          </Button>
          <Button variant="secondary" onClick={() => go("workout/choose")}>
            Programmes & routines <ArrowRight size={17} />
          </Button>
          <Button variant="secondary" onClick={() => go("library")}>
            Exercise library <ArrowRight size={17} />
          </Button>
          <p className="fine-print">
            Coach can make mistakes. Your chat, attached images and relevant
            journal entries are sent to{" "}
            {connection?.provider ?? "your assistant provider"} when you ask for
            help. Saved images are also shared when you ask Coach to read or
            analyse them; simply showing a gallery does not share their pixels.{" "}
            <a href="/privacy">Read our privacy policy</a>.
          </p>
          {turns.length > 0 && (
            <Button
              variant="ghost"
              disabled={
                busy ||
                Boolean(acting) ||
                queue.length > 0 ||
                Boolean(failedMessage)
              }
              onClick={() => {
                setOptionsOpen(false);
                setClear(true);
              }}
            >
              Clear conversation
            </Button>
          )}
        </div>
      </Dialog>
      <Dialog
        open={clear}
        onOpenChange={setClear}
        title="Clear this conversation?"
        description="Removes your saved chat and its proposal/undo cards from your account. Your workouts, cardio, meals, health check-ins and photo library stay in the journal."
      >
        <Button
          variant="danger"
          onClick={async () => {
            try {
              const r = await privateFetch("/api/agent", {
                method: "DELETE",
                headers: headers(),
              });
              if (!r.ok) throw Error("Could not clear the conversation.");
              setTurns([]);
              setClear(false);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not clear chat.",
              );
            }
          }}
        >
          Clear conversation
        </Button>
      </Dialog>
    </div>
  );
}
