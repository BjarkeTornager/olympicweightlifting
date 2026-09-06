"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  MessageCircle,
  Send,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { JournalController } from "./journal";
import type { ActionPreview } from "@/lib/agent/actions";
import { exerciseName } from "@/lib/domain";
import { formatSet } from "@/lib/training";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
type Turn = {
  id: string;
  question: string;
  reply?: string;
  proposals?: ActionPreview[];
  status: string;
};
export function TrainingAgent({
  journal,
  onLogin,
  go,
}: {
  journal: JournalController;
  onLogin: () => void;
  go: (r: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]),
    [message, setMessage] = useState(""),
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
  const send = async () => {
    const question = message.trim();
    if (!question || busy || !ready) return;
    const id = crypto.randomUUID();
    setBusy(true);
    setError("");
    setMessage("");
    setTurns((old) => [...old, { id, question, status: "running" }]);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          id,
          message: question,
          revision: journal.record!.revision,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
          t.id === id ? { id, question, ...result, status: "done" } : t,
        ),
      );
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
          : "Saved to your account. Your journal is up to date.",
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
  return (
    <div className="agent-page">
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            <Sparkles size={14} /> YOUR TRAINING ASSISTANT
          </div>
          <h1>Let’s talk training.</h1>
          <p className="lead">
            Ask about your progress. Tell me what you lifted. Make a plan for
            your next session.
          </p>
        </div>
        <a className="text-link" href="#dashboard">
          Training overview <ArrowRight size={17} />
        </a>
      </div>
      {journal.state?.activeWorkout && (
        <div className="notice draft-notice">
          <div>
            <strong>{journal.state.activeWorkout.title}</strong>
            <p>Unfinished workout · {journal.state.activeWorkout.date}</p>
          </div>
          <Button onClick={() => go("workout")}>
            Resume workout <ArrowRight size={17} />
          </Button>
        </div>
      )}
      {!accountId ? (
        <section className="panel agent-welcome">
          <MessageCircle size={28} />
          <h2>Your journal, in conversation.</h2>
          <p>
            Sign in to let the assistant read your saved training and prepare
            entries for you.
          </p>
          <Button onClick={onLogin}>Sign in to talk training</Button>
          <p className="fine-print">
            You can always log manually in Train, including offline.
          </p>
        </section>
      ) : (
        <>
          {connection && !connection.enabled && (
            <div className="notice">
              <div>
                <strong>Your assistant is being connected.</strong>
                <p>
                  Your journal is ready. Keep logging in Train while Ollama is
                  configured.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => void refresh().catch((e) => setError(e.message))}
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
              Uses {connection.provider} · Chat and relevant training
              are sent to your assistant provider.{" "}
              <a href="/privacy">Privacy</a>
            </p>
          )}
          {!turns.length && (
            <div className="agent-prompts">
              {[
                "What did I train last time?",
                "How is my accessory training progressing?",
                "Help me log a workout",
                "What should I train next?",
              ].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    setMessage(text);
                    input.current?.focus();
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
            aria-label="Training conversation"
            aria-busy={busy}
          >
            {turns.map((t) => (
              <article className="conversation-turn" key={t.id}>
                <div className="chat-user">
                  <span className="sr-only">You: </span>
                  {t.question}
                </div>
                {t.reply && (
                  <div className="chat-assistant">
                    <span className="assistant-mark">
                      <Sparkles size={16} /> Lift Journal
                    </span>
                    <p>{t.reply}</p>
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
                            p.workout &&
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
            <label htmlFor="training-message">
              Message your training assistant
            </label>
            <textarea
              id="training-message"
              ref={input}
              value={message}
              maxLength={6000}
              rows={3}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Yesterday I did Romanian deadlifts: 60 × 8, 80 × 8, 100 × 8…"
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
                disabled={!ready || busy || !message.trim()}
              >
                <Send size={17} />
                {busy ? "Thinking…" : "Send"}
              </Button>
            </div>
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
      <div className="agent-shortcuts">
        <a href="#workout/choose">Programmes & routines</a>
        <a href="#library">Exercise library</a>
        <a href="#progress">Training progress</a>
        <a href="#data">Account & backups</a>
      </div>
      <Dialog
        open={clear}
        onOpenChange={setClear}
        title="Clear this conversation?"
        description="Removes your saved chat and its proposal/undo cards from your account. Your workouts stay in the journal."
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
