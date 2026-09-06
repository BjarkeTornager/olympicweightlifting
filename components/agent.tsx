"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
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
import { DailyOverview, CheckinDialog, CheckinDetails } from "./health";
import { AssistantText } from "./assistant-text";
type Turn = {
  id: string;
  question: string;
  reply?: string;
  proposals?: ActionPreview[];
  status: string;
  photoIds?: string[];
};
export function TrainingAgent({
  journal,
  onLogin,
  go,
  initialPhotoId,
  initialSleepLog = false,
}: {
  journal: JournalController;
  onLogin: () => void;
  go: (r: string) => void;
  initialPhotoId?: string;
  initialSleepLog?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]),
    [message, setMessage] = useState(
      initialSleepLog ? sleepLoggingPrompt(Boolean(initialPhotoId)) : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [connection, setConnection] = useState<{
      enabled: boolean;
      provider: string | null;
    } | null>(null),
    [clear, setClear] = useState(false);
  const [acting, setActing] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"conversation" | "today">("conversation");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(6);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const newestId = turns.at(-1)?.id;
  const needsReview = (proposal: ActionPreview) =>
    !proposal.status && new Date(proposal.expiresAt).getTime() > now;
  const reviewCount = turns.reduce(
    (count, turn) => count + (turn.proposals?.filter(needsReview).length ?? 0),
    0,
  );
  useEffect(() => {
    if (view === "conversation" && newestId) {
      const frame = requestAnimationFrame(() => {
        const latest = conversation.current?.querySelector<HTMLElement>(
          ".conversation-turn:last-child",
        );
        if (latest && conversation.current)
          conversation.current.scrollTop = latest.offsetTop - 16;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [newestId, view]);
  const draft = (text: string) => {
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
  const accountId = journal.identity?.id;
  useEffect(() => {
    if (!initialPhotoId || !accountId) return;
    const abort = new AbortController();
    fetch(`/api/images/${encodeURIComponent(initialPhotoId)}?metadata=1`, {
      headers: { "X-Journal-Account": accountId },
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const image: UserImage & { error?: string } = await r.json();
        if (!r.ok) throw Error(image.error ?? "Image unavailable.");
        if (!abort.signal.aborted) {
          setPhotoIds([image.id]);
          setImageDetails({ [image.id]: image });
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
  }, [initialPhotoId, accountId]);
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "X-Journal-Account": accountId ?? "",
    }),
    [accountId],
  );
  const refresh = useCallback(async () => {
    if (!accountId) return;
    const r = await fetch("/api/agent", {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error ?? "The assistant is unavailable.");
    setConnection({ enabled: data.enabled, provider: data.provider });
    setTurns(data.turns);
  }, [accountId, headers]);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    fetch("/api/agent", {
      headers: headers(),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error ?? "The assistant is unavailable.");
        return data;
      })
      .then((data) => {
        setConnection({ enabled: data.enabled, provider: data.provider });
        setTurns(data.turns);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [accountId, headers]);
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
  const attach = async (file?: File) => {
    if (!file || !accountId || photoIds.length >= 4) return;
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
  const send = async (provided?: string) => {
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
    if (!question || busy || uploading || !ready) return;
    const attachments = [...photoIds];
    const id = crypto.randomUUID();
    setBusy(true);
    setError("");
    setMessage("");
    setTurns((old) => [
      ...old,
      { id, question, photoIds: attachments, status: "running" },
    ]);
    setView("conversation");
    setToolsOpen(false);
    input.current?.blur();
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          id,
          message: question,
          revision: journal.record!.revision,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          photoIds: attachments,
        }),
        signal: AbortSignal.timeout(110000),
      });
      const result = await r.json();
      if (!r.ok)
        throw Error(
          result.error ?? "The assistant could not complete that request.",
        );
      setTurns((old) =>
        old.map((t) =>
          t.id === id
            ? { id, question, photoIds: attachments, ...result, status: "done" }
            : t,
        ),
      );
      setPhotoIds([]);
      setImageDetails({});
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The request failed. Your journal is safe.",
      );
      setMessage((current) => current || question);
      setTurns((old) =>
        old.map((t) => (t.id === id ? { ...t, status: "failed" } : t)),
      );
    } finally {
      setBusy(false);
    }
  };
  const apply = async (p: ActionPreview, undo = false) => {
    if (pending || acting) return;
    setActing(p.id);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/agent/action", {
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
          proposals: t.proposals?.map((v) =>
            v.id === p.id ? { ...v, status: data.status } : v,
          ),
        })),
      );
      await journal.sync();
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
    setMessage(question);
    if (ready) void send(question);
    else {
      input.current?.focus();
      setError(
        pending
          ? "Sync your journal first so Coach can use your latest entries."
          : "Connect your assistant and sync your journal to build a personalised plan.",
      );
      input.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  return (
    <div className="agent-page">
      <header className="coach-header">
        <div className="coach-title">
          <span className="coach-avatar" aria-hidden="true">
            <Sparkles size={22} />
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
          </nav>
          <span className={`coach-connection ${ready ? "connected" : ""}`}>
            {ready
              ? "Ready to help"
              : accountId
                ? "Connecting…"
                : "Personal to you"}
          </span>
        </div>
      </header>
      <div className="coach-today" hidden={view !== "today"}>
        <DailyOverview
          journal={journal}
          onCheckin={() => setCheckinDate(today())}
          onAsk={ask}
          go={go}
          busy={busy || Boolean(acting) || uploading}
        />
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
              Coach. Review suggested entries before saving.
            </p>
            <Button onClick={onLogin}>Sign in to talk with Coach</Button>
            <p className="fine-print">
              Your daily check-in and manual logging also work on this device.
            </p>
          </section>
        ) : (
          <>
            {connection && !connection.enabled && (
              <div className="notice">
                <div>
                  <strong>Your assistant is being connected.</strong>
                  <p>
                    Your journal is ready. Keep logging in Train while the
                    assistant connection is configured.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void refresh().catch((e) => setError(e.message))
                  }
                >
                  Check connection
                </Button>
              </div>
            )}
            {pending && (
              <div className="notice">
                <span>
                  Sync your pending changes so the assistant has your latest
                  training.
                </span>
                <Button variant="secondary" onClick={() => void journal.sync()}>
                  Sync now
                </Button>
              </div>
            )}
            {(turns.length > 1 || reviewCount > 0) && (
              <div className="coach-thread-tools">
                {reviewCount > 0 ? (
                  <button
                    className="coach-review-jump"
                    onClick={() => {
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
                <button
                  onClick={() => {
                    const latest =
                      conversation.current?.querySelector<HTMLElement>(
                        ".conversation-turn:last-child",
                      );
                    if (latest && conversation.current)
                      conversation.current.scrollTop = latest.offsetTop - 16;
                  }}
                >
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
            >
              {!turns.length && (
                <div className="coach-start">
                  <span className="coach-start-icon" aria-hidden="true">
                    <Sparkles size={26} />
                  </span>
                  <h2>What’s on your mind today?</h2>
                  <p>
                    Log a meal, make sense of your sleep, or plan your next
                    session.
                  </p>
                  <div className="agent-prompts">
                    {[
                      "What should I focus on today?",
                      "How is my recovery looking?",
                    ].map((text) => (
                      <button
                        key={text}
                        disabled={busy}
                        onClick={() => ask(text)}
                      >
                        {text}
                        <ArrowRight size={16} />
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
                    {t.question}
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
                  {t.reply && (
                    <div className="chat-assistant">
                      <span className="assistant-mark">
                        <Sparkles size={16} /> Lift Journal
                      </span>
                      <AssistantText text={t.reply} />
                    </div>
                  )}
                  {t.status === "running" && (
                    <p className="muted">
                      {busy
                        ? "Looking through your journal…"
                        : "This request has not completed. You can ask again."}
                    </p>
                  )}
                  {t.status === "failed" && (
                    <p className="fine-print">
                      This request didn’t finish. No change was confirmed.
                    </p>
                  )}
                  {t.proposals?.map((p) => (
                    <section
                      key={p.id}
                      className={`agent-proposal ${p.status ?? "pending"}`}
                      aria-label="Review journal change"
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
                                ["calories", "protein", "carbs", "fat"] as const
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
                                  : "Save this change"}
                              </Button>
                            )}
                            {p.status === "saved" && (
                              <Button
                                variant="secondary"
                                disabled={pending || Boolean(acting) || busy}
                                onClick={() => void apply(p, true)}
                              >
                                <Undo2 size={17} />
                                Undo this change
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() =>
                                go(
                                  p.checkin
                                    ? "health"
                                    : p.meal || p.targets
                                      ? "food"
                                      : p.workout &&
                                          p.workout.exercises.some((e) =>
                                            e.sets.some((s) => !s.result),
                                          )
                                        ? "workout"
                                        : "history",
                                )
                              }
                            >
                              Open journal <ArrowRight size={17} />
                            </Button>
                          </div>
                          <p className="fine-print">
                            {p.status
                              ? "Undo is available for 24 hours while no later journal change has been saved."
                              : `Proposal expires ${new Date(p.expiresAt).toLocaleString()}. A newer journal change requires a fresh proposal.`}
                          </p>
                        </div>
                      </details>
                    </section>
                  ))}
                </article>
              ))}
            </div>

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
              <label htmlFor="training-message">Message your coach</label>
              <textarea
                id="training-message"
                ref={input}
                value={message}
                maxLength={6000}
                rows={2}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell me what you ate, how you slept, or what you need…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
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
                    disabled={busy || uploading || loadingImage}
                    onClick={() =>
                      draft(
                        "Help me log what I ate. Ask for any missing meal details and prepare it for review.",
                      )
                    }
                  >
                    <Utensils size={16} /> <span>Log food</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || uploading || loadingImage}
                    onClick={() =>
                      draft(
                        message.trim()
                          ? "Please use this to log my sleep. Ask about any unclear date or time asleep and prepare the entry for review."
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
                    busy ||
                    uploading ||
                    (!message.trim() && !photoIds.length)
                  }
                >
                  <Send size={17} />
                  {busy ? "Thinking…" : "Send"}
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
                        busy ||
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
                        busy ||
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
                </div>
                <label className="image-auto-tag">
                  <input
                    type="checkbox"
                    checked={autoTag}
                    disabled={busy || uploading}
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
                          disabled={busy}
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
              {!ready && connection?.enabled && !pending && (
                <p className="fine-print">
                  Sign in and connect to the internet to use the assistant.
                </p>
              )}
            </form>
            <p className="coach-composer-note">
              Review suggested entries before saving.{" "}
              <button onClick={() => setOptionsOpen(true)}>
                Privacy & details
              </button>
            </p>
          </>
        )}
      </section>
      <Dialog
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        title="Coach options"
      >
        <div className="coach-options">
          <Button variant="secondary" onClick={() => go("health")}>
            Health history <ArrowRight size={17} />
          </Button>
          <Button variant="secondary" onClick={() => go("images")}>
            Image library & categories <ArrowRight size={17} />
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
            help. <a href="/privacy">Read our privacy policy</a>.
          </p>
          {turns.length > 0 && (
            <Button
              variant="ghost"
              disabled={busy || Boolean(acting)}
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
        description="Removes your saved chat and its proposal/undo cards from your account. Your workouts, meals, health check-ins and photo library stay in the journal."
      >
        <Button
          variant="danger"
          onClick={async () => {
            try {
              const r = await fetch("/api/agent", {
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
