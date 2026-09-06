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
} from "lucide-react";
import type { JournalController } from "./journal";
import type { ActionPreview } from "@/lib/agent/actions";
import { exerciseName, today } from "@/lib/domain";
import { uploadFoodPhoto } from "@/lib/food-client";
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
}: {
  journal: JournalController;
  onLogin: () => void;
  go: (r: string) => void;
  initialPhotoId?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]),
    [message, setMessage] = useState(
      initialPhotoId
        ? "Estimate this meal from the attached photo and prepare a food entry. Use its catalog date. Explain the portion assumptions."
        : "",
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
  const [photoIds, setPhotoIds] = useState<string[]>(
    initialPhotoId ? [initialPhotoId] : [],
  );
  const [uploading, setUploading] = useState(false);
  const [checkinDate, setCheckinDate] = useState<string | null>(null);
  const accountId = journal.identity?.id;
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
    accountId && connection?.enabled && !pending && journal.status === "synced",
  );
  const attach = async (file?: File) => {
    if (!file || !accountId || photoIds.length >= 4) return;
    setUploading(true);
    setError("");
    try {
      const photo = await uploadFoodPhoto(
        file,
        accountId,
        today(),
        message.trim().slice(0, 160) || "Meal photo",
      );
      setPhotoIds((ids) => [...ids, photo.id]);
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
        ? "Estimate the meal in these photos and prepare a food entry for today. Explain your portion assumptions."
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
    requestAnimationFrame(() =>
      document
        .getElementById("coach-conversation")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
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
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The request failed. Your journal is safe.",
      );
      setMessage(question);
      setTurns((old) =>
        old.map((t) => (t.id === id ? { ...t, status: "failed" } : t)),
      );
    } finally {
      setBusy(false);
      input.current?.focus();
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
      <DailyOverview
        journal={journal}
        onCheckin={() => setCheckinDate(today())}
        onAsk={ask}
        go={go}
        busy={busy || Boolean(acting) || uploading}
      />
      <CheckinDialog
        journal={journal}
        date={checkinDate}
        onClose={() => setCheckinDate(null)}
      />
      <section
        className="coach-workspace"
        aria-label="Coach conversation workspace"
      >
        <div className="coach-workspace-heading">
          <span className="coach-avatar">
            <Sparkles size={21} />
          </span>
          <div>
            <h2>Your coach, in conversation.</h2>
            <p>
              Describe a meal, log how you feel, or work out your next step.
            </p>
          </div>
          <span className={`coach-connection ${ready ? "connected" : ""}`}>
            {ready
              ? "Ready to help"
              : accountId
                ? "Connect to chat"
                : "Personal to you"}
          </span>
        </div>
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
            {connection?.provider && (
              <p className="agent-provider">
                Uses {connection.provider} · Chat, attached photos and relevant
                training, food and health check-ins are sent to your assistant
                provider. <a href="/privacy">Privacy</a>
              </p>
            )}
            {!turns.length && (
              <div className="agent-prompts">
                {[
                  "What should I focus on today?",
                  "How is my recovery looking?",
                  "Help me log what I ate",
                  "Review my training this week",
                ].map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      ask(text);
                    }}
                  >
                    <Sparkles size={17} />
                    {text}
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            )}
            <div
              className="conversation"
              role="log"
              id="coach-conversation"
              aria-label="Coach conversation"
              aria-busy={busy}
            >
              {turns.map((t) => (
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
                            label="Attached meal photo"
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
                      aria-label="Review training change"
                    >
                      <div className="eyebrow">
                        {p.status === "saved"
                          ? "SAVED"
                          : p.status === "undone"
                            ? "UNDONE"
                            : "REVIEW BEFORE SAVING"}
                      </div>
                      <h2>{p.title}</h2>
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
                              new Date(p.expiresAt).getTime() < Date.now()
                            }
                            onClick={() => void apply(p)}
                          >
                            <Check size={17} />
                            {acting === p.id ? "Saving…" : "Save this change"}
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
                rows={3}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="I slept 7 hours, feel a little sore, and had eggs on toast. Help me plan today…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-actions">
                <span className="fine-print">
                  Review entries before saving. The assistant can make mistakes.
                </span>
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
              <div className="food-attachments">
                <label className="food-upload">
                  <Camera size={17} />{" "}
                  {uploading ? "Saving photo…" : "Take meal photo"}
                  <input
                    type="file"
                    aria-label="Take meal photo"
                    accept="image/*"
                    capture="environment"
                    disabled={
                      busy || uploading || !accountId || photoIds.length >= 4
                    }
                    onChange={(e) => {
                      void attach(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="food-upload">
                  Attach photo
                  <input
                    type="file"
                    aria-label="Attach meal photo"
                    accept="image/*"
                    disabled={
                      busy || uploading || !accountId || photoIds.length >= 4
                    }
                    onChange={(e) => {
                      void attach(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <a href="#food">Food journal & photo library</a>
              </div>
              {photoIds.length > 0 && accountId && (
                <>
                  <div className="food-photo-strip">
                    {photoIds.map((id) => (
                      <div key={id}>
                        <FoodPhotoImage
                          id={id}
                          accountId={accountId}
                          label="Meal photo ready to send"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            setPhotoIds((ids) => ids.filter((v) => v !== id))
                          }
                        >
                          Remove attachment
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="fine-print">
                    Saved privately in Food. Sending shares these photos with{" "}
                    {connection?.provider ?? "the assistant provider"} for
                    estimation. Removing an attachment keeps its catalog copy.
                    Up to 4 photos per message.
                  </p>
                </>
              )}
              {!ready && connection?.enabled && !pending && (
                <p className="fine-print">
                  Sign in and connect to the internet to use the assistant.
                </p>
              )}
            </form>
            {turns.length > 0 && (
              <Button
                variant="ghost"
                disabled={busy || Boolean(acting)}
                onClick={() => setClear(true)}
              >
                Clear conversation
              </Button>
            )}
          </>
        )}
      </section>
      <div className="agent-shortcuts">
        <a href="#health">Health history</a>
        <a href="#food">Food journal & photos</a>
        <a href="#workout/choose">Programmes & routines</a>
        <a href="#library">Exercise library</a>
        <a href="#progress">Training progress</a>
        <a href="#data">Account & backups</a>
      </div>
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
