"use client";
import { privateFetch } from "@/lib/private-fetch";
import { useConversationScroll } from "@/lib/use-conversation-scroll";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCoachConnection } from "@/lib/use-coach-connection";
import { useCoachRun } from "@/lib/use-coach-run";
import { markProposal, mergeSavedTurns } from "@/lib/coach-turns";
import { coachBackgroundStatus, coachConnectionHint } from "@/lib/coach-status";
import {
  MessageCircle,
  Send,
  Plus,
  MoreHorizontal,
  ChevronDown,
  LoaderCircle,
  Mic,
  CalendarDays,
  Table2,
} from "@/components/ui/icons";
import type { JournalController } from "./journal";
import type { ActionPreview } from "@/lib/agent/actions";
import { today } from "@/lib/domain";
import { uploadUserImage } from "@/lib/food-client";
import { consumeActivityPhoto } from "@/lib/activity-photo-client";
import {
  imageCoachPrompt,
  activityLoggingPrompt,
  sleepLoggingPrompt,
  type UserImage,
} from "@/lib/images";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { CheckinDialog } from "./health";
import { CoachOpening } from "./coach-opening";
import { CoachMemoryBook } from "./coach-memory";
import { LiftingVideoDialog } from "./lifting-video-upload";
import { QuickCapture } from "./quick-capture";
import { VoiceCheckin } from "./voice-checkin";
import { useVoiceEnabled, type SaveResult } from "@/lib/use-voice-checkin";
import { CoachTurn, type Turn } from "./coach-turn";
import { proposalNeedsReview } from "@/lib/coach-proposals";
import {
  CoachQueue,
  MAX_QUEUED_MESSAGES,
  QUEUE_FULL_MESSAGE,
  queuedMessage,
} from "./coach-queue";
import { CoachImageTools } from "./coach-image-tools";
import { CoachOptions } from "./coach-options";
import {
  ComposerAttachments,
  ComposerQuickActions,
  ComposerReconnect,
} from "./coach-composer";
import { WhistleIcon } from "./ui/journal-icons";
export function TrainingAgent({
  journal,
  onLogin,
  go,
  visible,
  entryId,
  initialPhotoId,
  initialSleepLog = false,
  initialCardioLog = false,
  initialActivityPhotoLog = false,
  initialTrainingPrompt,
  initialVideoReview = false,
  initialCapture = false,
  initialVoice = false,
  initialMemories,
}: {
  journal: JournalController;
  onLogin: () => void;
  go: (r: string) => void;
  visible: boolean;
  entryId: number;
  initialPhotoId?: string;
  initialSleepLog?: boolean;
  initialCardioLog?: boolean;
  initialActivityPhotoLog?: boolean;
  initialTrainingPrompt?: string;
  initialVideoReview?: boolean;
  initialCapture?: boolean;
  initialVoice?: boolean;
  initialMemories?: "memories" | "plans";
}) {
  const entryPrompt = initialSleepLog
    ? sleepLoggingPrompt(Boolean(initialPhotoId))
    : initialCardioLog && !initialActivityPhotoLog
      ? activityLoggingPrompt(Boolean(initialPhotoId))
      : (initialTrainingPrompt ?? "");
  const [turns, setTurns] = useState<Turn[]>([]),
    [message, setMessage] = useState(entryPrompt),
    [error, setError] = useState("");
  const [clear, setClear] = useState(false);
  const [acting, setActing] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  // A submitted draft cannot be accepted twice before React clears the composer.
  const submittedDraft = useRef<string | null>(null);
  const submittedVideoReviews = useRef(new Set<string>());
  const submittedActivityPhotos = useRef(new Set<string>());
  const [view, setView] = useState<"conversation" | "today" | "week">(
    "conversation",
  );

  useLayoutEffect(() => {
    const field = input.current;
    if (!field || !visible || view !== "conversation") return;
    const fit = () => {
      const limit = parseFloat(getComputedStyle(field).maxHeight) || 160;
      field.style.height = "0px";
      field.style.height = `${Math.min(limit, Math.max(64, field.scrollHeight))}px`;
    };
    fit();
    window.visualViewport?.addEventListener("resize", fit);
    window.addEventListener("resize", fit);
    return () => {
      window.visualViewport?.removeEventListener("resize", fit);
      window.removeEventListener("resize", fit);
    };
  }, [message, visible, view]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const attachmentButton = useRef<HTMLButtonElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(initialVideoReview);
  const [memoriesOpen, setMemoriesOpen] = useState(Boolean(initialMemories));
  const [memoryTab, setMemoryTab] = useState<"memories" | "plans">(
    initialMemories ?? "memories",
  );
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
    proposalNeedsReview(proposal, now);
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
  const uploadInFlight = useRef(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [checkinDate, setCheckinDate] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(initialCapture);
  const [voiceOpen, setVoiceOpen] = useState(initialVoice);
  const [handledEntry, setHandledEntry] = useState(entryId);
  const [wasVisible, setWasVisible] = useState(visible);
  // Apply a navigation intent once without discarding an existing draft or run.
  if (handledEntry !== entryId) {
    setHandledEntry(entryId);
    setLoadingImage(Boolean(initialPhotoId));
    if (initialVideoReview) setVideoOpen(true);
    if (initialCapture) setCaptureOpen(true);
    if (initialVoice) setVoiceOpen(true);
    if (initialMemories) {
      setMemoriesOpen(true);
      setMemoryTab(initialMemories);
    }
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
  const accountId = journal.identity?.id;
  const coach = useCoachConnection(accountId, (saved) =>
    setTurns((current) => mergeSavedTurns(saved, current)),
  );
  const { connection, headers } = coach;
  const connectionLoading = coach.loading,
    connectionError = coach.error;
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
  const run = useCoachRun({
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
  });
  const { queue, failedMessage, busy, backgroundResult, enqueue } = run;
  const voiceEnabled = useVoiceEnabled(accountId);
  // A spoken report becomes an ordinary queued Coach message; the call waits
  // for that turn so it can tell the athlete what was saved.
  const voiceWaits = useRef(new Map<string, (r: SaveResult) => void>());
  useEffect(() => {
    for (const [id, resolve] of voiceWaits.current) {
      const turn = turns.find((t) => t.id === id);
      if (turn?.status !== "done" && turn?.status !== "failed") continue;
      voiceWaits.current.delete(id);
      const saved = (turn.proposals ?? [])
        .filter((p) => p.status === "saved")
        .map((p) => p.title);
      resolve(
        saved.length
          ? { ok: true, detail: saved.join("; ") }
          : {
              ok: false,
              detail:
                turn.status === "failed"
                  ? "Coach could not save it. It is kept in Coach to retry."
                  : `Nothing saved. Coach replied: ${(turn.reply ?? "").slice(0, 400)}`,
            },
      );
    }
  }, [turns]);
  const saveSpoken = (report: string) =>
    new Promise<SaveResult>((resolve) => {
      if (queue.length >= MAX_QUEUED_MESSAGES)
        return resolve({ ok: false, detail: QUEUE_FULL_MESSAGE });
      const job = queuedMessage(
        crypto.randomUUID(),
        `From my spoken check-in (transcribed, so numbers may be misheard): ${report}`,
        [],
      );
      voiceWaits.current.set(job.id, resolve);
      enqueue(job);
      setTimeout(() => {
        if (voiceWaits.current.delete(job.id))
          resolve({
            ok: false,
            detail: "Coach is still working on it. Check Coach afterwards.",
          });
      }, 90000);
    });
  // Opening Coach acknowledges a reply that finished in the background.
  if (visible && backgroundResult) run.setBackgroundResult(null);
  // Read by the photo loader, which must not restart when the queue changes.
  const queueSize = useRef(queue.length);
  useEffect(() => {
    queueSize.current = queue.length;
  }, [queue.length]);
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
          if (
            initialActivityPhotoLog &&
            submittedActivityPhotos.current.has(image.id)
          )
            return;
          if (
            initialActivityPhotoLog &&
            consumeActivityPhoto(accountId, image.id)
          ) {
            if (queueSize.current >= MAX_QUEUED_MESSAGES) {
              setPhotoIds((ids) => [...new Set([...ids, image.id])]);
              setImageDetails((details) => ({ ...details, [image.id]: image }));
              setMessage((current) => current || activityLoggingPrompt(true));
              throw Error(
                "Your photo is saved and attached. Send it once Coach has room in the queue.",
              );
            }
            submittedActivityPhotos.current.add(image.id);
            enqueue(
              queuedMessage(image.id, activityLoggingPrompt(true), [image.id]),
            );
            setView("conversation");
            setNotice(
              "Activity photo queued. Coach will log the visible details with Undo.",
            );
            return;
          }
          submittedDraft.current = null;
          setPhotoIds((ids) => [...new Set([...ids, image.id])]);
          setImageDetails((details) => ({ ...details, [image.id]: image }));
          setMessage(
            (current) =>
              current ||
              (initialCardioLog
                ? activityLoggingPrompt(true)
                : imageCoachPrompt(image.category)),
          );
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingImage(false);
      });
    return () => abort.abort();
  }, [
    entryId,
    initialPhotoId,
    accountId,
    initialActivityPhotoLog,
    initialCardioLog,
    enqueue,
  ]);
  const reconnecting = connectionLoading || journal.status === "syncing";
  const connectionHint = coachConnectionHint({
    conflict: Boolean(journal.record?.conflict),
    pending,
    journalStatus: journal.status,
    connectionError,
    connecting: connectionLoading,
    enabled: Boolean(connection?.enabled),
    loadingImage,
  });
  const reconnect = () => {
    // Recheck independently: neither failure should prevent the other recovery.
    // Never submit the draft or save a proposal as a side effect of reconnecting.
    void journal.sync();
    coach.reconnect();
  };
  const attach = async (input?: File | File[], purpose?: "meal-photo") => {
    const files = input ? (Array.isArray(input) ? input : [input]) : [];
    if (!files.length || !accountId || loadingImage || uploadInFlight.current)
      return;
    if (files.length + photoIds.length > 4) {
      setError(
        `Choose up to ${4 - photoIds.length} more photos. Nothing from this selection was uploaded.`,
      );
      return;
    }
    uploadInFlight.current = true;
    submittedDraft.current = null;
    setToolsOpen(false);
    setUploading(true);
    setError("");
    try {
      const failures: string[] = [];
      for (const [index, file] of files.entries()) {
        setUploadProgress(
          files.length > 1
            ? `Saving photo ${index + 1} of ${files.length}…`
            : "",
        );
        try {
          const photo = await uploadUserImage(
            file,
            accountId,
            today(),
            purpose ? "Meal photo" : "Uploaded image",
            autoTag,
            purpose,
          );
          setPhotoIds((ids) => [...new Set([...ids, photo.id])]);
          setImageDetails((old) => ({ ...old, [photo.id]: photo }));
        } catch (e) {
          failures.push(
            files.length === 1
              ? e instanceof Error
                ? e.message
                : "Could not upload photo."
              : `${file.name}: ${e instanceof Error ? e.message : "Could not upload photo."}`,
          );
        }
      }
      if (failures.length)
        setError(
          `${failures.join(" ")}${files.length > 1 ? " Other successfully uploaded photos are still attached. Retry only the failed photos before sending." : ""}`,
        );
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
      setUploadProgress("");
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
                : photoIds.every(
                      (id) => imageDetails[id]?.category === "activity",
                    )
                  ? "activity"
                  : "unclassified",
            photoIds.length,
          )
        : "");
    if (!question || uploading || !ready || photoIds.length > 4) return;
    if (queue.length >= MAX_QUEUED_MESSAGES) {
      setError(QUEUE_FULL_MESSAGE);
      return;
    }
    const signature = JSON.stringify([question, photoIds]);
    if (submittedDraft.current === signature) return;
    submittedDraft.current = signature;
    const job = queuedMessage(crypto.randomUUID(), question, [...photoIds]);
    enqueue(job);
    setMessage("");
    setPhotoIds([]);
    setImageDetails({});
    setView("conversation");
    setToolsOpen(false);
    if (!failedMessage) setError("");
    // Keep keyboard focus so another message can follow immediately.
    input.current?.focus({ preventScroll: true });
  };
  const apply = async (p: ActionPreview, undo = false) => {
    if (pending || acting || run.running()) return;
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
      setTurns((old) => markProposal(old, p.id, data.status, undo));
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
    const status = coachBackgroundStatus({
      failed: Boolean(failedMessage),
      busy,
      queued: queue.length,
      acting: Boolean(acting),
      preparingPhoto: uploading || loadingImage,
      result: backgroundResult,
    });
    return status ? (
      <div className="coach-background-status">
        <span role="status">
          {busy || acting || uploading || loadingImage ? (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          ) : (
            <WhistleIcon size={18} aria-hidden="true" />
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
          Open Coach
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
        compact={turns.length > 0 || Boolean(journal.state?.activeWorkout)}
        disabled={busy || Boolean(acting) || uploading}
        onDiscuss={ask}
      />
    ) : null;
  return (
    <div className="agent-page">
      <header className="coach-header">
        <div className="coach-title">
          <span className="coach-avatar" aria-hidden="true">
            <WhistleIcon size={25} />
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
      <div className="quick-capture-bar">
        <Button onClick={() => setCaptureOpen(true)}>
          <Plus size={19} /> Log something
        </Button>
        {voiceEnabled ? (
          <Button variant="secondary" onClick={() => setVoiceOpen(true)}>
            <Mic size={19} /> Check in by voice
          </Button>
        ) : (
          <span>Food, sleep or training</span>
        )}
      </div>
      <VoiceCheckin
        open={voiceOpen && visible}
        onOpenChange={setVoiceOpen}
        headers={headers}
        onSave={saveSpoken}
        onReview={() => setView("conversation")}
      />
      <QuickCapture
        journal={journal}
        open={captureOpen && visible}
        onOpenChange={setCaptureOpen}
        photoDisabled={
          uploading || loadingImage || !accountId || photoIds.length >= 4
        }
        onDescribe={() => {
          setView("conversation");
          requestAnimationFrame(() =>
            input.current?.focus({ preventScroll: true }),
          );
        }}
        onPhoto={(file) => {
          if (photoIds.length + (Array.isArray(file) ? file.length : 1) > 4) {
            setError(
              `Choose up to ${4 - photoIds.length} more photos. Nothing from this selection was uploaded.`,
            );
            return;
          }
          draft(
            imageCoachPrompt(
              "food",
              photoIds.length + (Array.isArray(file) ? file.length : 1),
            ),
          );
          void attach(file, "meal-photo");
        }}
      />
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
                    <p>Ask a question, or record food, sleep or training.</p>
                    {journal.state?.activeWorkout && (
                      <div className="notice">
                        <div>
                          <strong>
                            {journal.state.activeWorkout.title} is in progress.
                          </strong>
                          <p>Logged sets are already saved on this device.</p>
                        </div>
                        <Button onClick={() => go("workout")}>
                          Resume workout
                        </Button>
                      </div>
                    )}
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
                  <CoachTurn
                    key={t.id}
                    turn={t}
                    accountId={accountId}
                    active={busy && t.id === run.activeId}
                    onStop={run.stop}
                    proposal={{
                      now,
                      ready,
                      pending,
                      busy,
                      acting,
                      onApply: (p, undo) => void apply(p, undo),
                      onOpenMemories: openMemories,
                      go,
                    }}
                  />
                ))}
              </div>
            </div>

            {(queue.length > 0 || failedMessage) && (
              <CoachQueue
                queue={queue}
                failedMessage={failedMessage}
                disabled={busy || !ready || Boolean(acting)}
                onRetry={run.retryFailed}
                onSkip={() => void run.skipFailed()}
                onRemove={run.remove}
              />
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
            {uploading && (
              <div className="notice coach-photo-progress" role="status">
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                {autoTag
                  ? uploadProgress || "Saving and tagging your photo…"
                  : "Saving your photo…"}
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
                <ComposerQuickActions
                  disabled={uploading || loadingImage}
                  hasText={Boolean(message.trim())}
                  photoCount={photoIds.length}
                  onDraft={draft}
                />
                <div className="composer-send-controls">
                  <Button
                    type="button"
                    variant="ghost"
                    className="composer-attach-button"
                    ref={attachmentButton}
                    aria-label="Add images"
                    aria-haspopup="dialog"
                    aria-expanded={toolsOpen}
                    aria-controls="coach-image-tools"
                    onClick={() => setToolsOpen((open) => !open)}
                  >
                    <Plus size={20} />
                  </Button>
                  <Button
                    type="submit"
                    className="composer-send-button"
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
              </div>
              <Dialog
                open={toolsOpen && visible}
                onOpenChange={setToolsOpen}
                title="Add photos to Coach"
                description="Take a photo or choose up to four images. Your message stays here."
                className="coach-image-dialog"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  attachmentButton.current?.focus({ preventScroll: true });
                }}
              >
                <CoachImageTools
                  signedIn={Boolean(accountId)}
                  uploading={uploading}
                  loadingImage={loadingImage}
                  attachmentsFull={photoIds.length >= 4}
                  autoTag={autoTag}
                  provider={connection?.provider}
                  onAutoTagChange={setAutoTag}
                  onAttach={(files) => void attach(files)}
                  onClose={() => setToolsOpen(false)}
                  onLogActivity={() => {
                    setToolsOpen(false);
                    draft(activityLoggingPrompt(photoIds.length > 0));
                  }}
                  onReviewVideo={() => {
                    setToolsOpen(false);
                    setVideoOpen(true);
                  }}
                />
              </Dialog>
              {photoIds.length > 0 && accountId && (
                <ComposerAttachments
                  photoIds={photoIds}
                  accountId={accountId}
                  imageDetails={imageDetails}
                  provider={connection?.provider}
                  onRemove={(id) =>
                    setPhotoIds((ids) => ids.filter((v) => v !== id))
                  }
                />
              )}
              {!ready && (
                <ComposerReconnect
                  hint={connectionHint}
                  journalError={journal.error}
                  canReconnect={!loadingImage && !journal.record?.conflict}
                  reconnecting={reconnecting}
                  onReconnect={reconnect}
                />
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
                ? QUEUE_FULL_MESSAGE
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
            enqueue(
              queuedMessage(
                id,
                prompt,
                photos.map((photo) => photo.id),
              ),
            );
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
        <CoachOptions
          journal={journal}
          preferencesKey={`${accountId}:${optionsOpen}`}
          provider={connection?.provider}
          disabled={
            busy || Boolean(acting) || Boolean(journal.record?.conflict)
          }
          showClear={turns.length > 0}
          clearDisabled={
            busy ||
            Boolean(acting) ||
            queue.length > 0 ||
            Boolean(failedMessage)
          }
          onOpenMemories={() => {
            setOptionsOpen(false);
            openMemories();
          }}
          onClear={() => {
            setOptionsOpen(false);
            setClear(true);
          }}
          go={go}
        />
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
