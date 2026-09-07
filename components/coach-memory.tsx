"use client";
import { useState } from "react";
import {
  coachSettings,
  memoryInputSchema,
  planInputSchema,
  type CoachMemory,
  type CoachPlan,
} from "@/lib/coaching";
import { today, uid } from "@/lib/domain";
import { offsetDate } from "@/lib/health";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function CoachMemoryBook({
  journal,
  disabled = false,
  initialTab = "memories",
}: {
  journal: JournalController;
  disabled?: boolean;
  initialTab?: "memories" | "plans";
}) {
  const [tab, setTab] = useState<"memories" | "plans">(initialTab);
  const [editor, setEditor] = useState<CoachMemory | CoachPlan | "new" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const settings = journal.state?.profile.coaching;
  const records =
    tab === "memories" ? (settings?.memories ?? []) : (settings?.plans ?? []);
  async function save(
    change: Parameters<JournalController["update"]>[0],
    message: string,
  ) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await journal.update(change);
      setEditor(null);
      setNotice(message);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="coach-memory-book">
      <div className="coach-view-switch" aria-label="Saved coaching context">
        <button
          aria-pressed={tab === "memories"}
          onClick={() => setTab("memories")}
        >
          Memories
        </button>
        <button aria-pressed={tab === "plans"} onClick={() => setTab("plans")}>
          Agreed plans
        </button>
      </div>
      <p className="muted">
        {tab === "memories"
          ? "Only preferences you approve. Coach uses these in future conversations."
          : "Things you chose to try. Follow-up happens when you visit from the agreed date."}
      </p>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {records.length === 0 && (
        <p className="coach-empty">
          {tab === "memories"
            ? "No saved memories yet. A food preference, your equipment or a routine is a good place to start."
            : "No agreed plans yet. Choose one small thing with Coach, or add your own."}
        </p>
      )}
      <div className="coach-record-list">
        {records.map((record) => (
          <article className="coach-record" key={record.id}>
            {"text" in record ? (
              <>
                <span className="eyebrow">{record.category}</span>
                <p>{record.text}</p>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  {record.status} · follow-up {record.followUpDate}
                </span>
                <h3>{record.title}</h3>
                {record.notes && <p>{record.notes}</p>}
                {record.outcome && <p>What happened: {record.outcome}</p>}
              </>
            )}
            <div className="button-row">
              <Button
                variant="secondary"
                disabled={disabled || saving}
                onClick={() => {
                  setError("");
                  setEditor(record);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || saving}
                onClick={() =>
                  void save(
                    (state) => {
                      const coaching = coachSettings(state);
                      if (tab === "memories")
                        coaching.memories = (coaching.memories ?? []).filter(
                          (m) => m.id !== record.id,
                        );
                      else
                        coaching.plans = (coaching.plans ?? []).filter(
                          (p) => p.id !== record.id,
                        );
                    },
                    tab === "memories"
                      ? "Memory deleted. Earlier chat messages are kept."
                      : "Plan deleted. Earlier chat messages are kept.",
                  )
                }
              >
                Delete
              </Button>
            </div>
          </article>
        ))}
      </div>
      <Button
        disabled={
          disabled ||
          saving ||
          records.length >= (tab === "memories" ? 40 : 100)
        }
        onClick={() => {
          setError("");
          setEditor("new");
        }}
      >
        {" "}
        {tab === "memories" ? "Add a memory" : "Add an agreed plan"}
      </Button>
      <p className="fine-print">
        These records sync with your private journal. Clearing chat keeps them;
        deleting them keeps earlier chat messages.
      </p>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null);
        }}
        title={
          tab === "memories"
            ? "What should Coach remember?"
            : "Your agreed plan"
        }
      >
        {editor && (
          <form
            className="form-stack"
            key={typeof editor === "string" ? editor : editor.id}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const existing = typeof editor === "string" ? undefined : editor;
              try {
                const now = new Date().toISOString();
                if (tab === "memories") {
                  const memory = {
                    ...memoryInputSchema.parse({
                      category: data.get("category"),
                      text: data.get("text"),
                    }),
                    id: existing?.id ?? uid(),
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                  };
                  void save((state) => {
                    const coaching = coachSettings(state);
                    coaching.memories = [
                      ...(coaching.memories ?? []).filter(
                        (m) => m.id !== memory.id,
                      ),
                      memory,
                    ];
                  }, "Memory saved for future conversations.");
                } else {
                  const plan = {
                    ...planInputSchema.parse({
                      title: data.get("title"),
                      notes: data.get("notes"),
                      followUpDate: data.get("followUpDate"),
                      status: data.get("status"),
                      outcome: data.get("outcome"),
                    }),
                    id: existing?.id ?? uid(),
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                  };
                  void save((state) => {
                    const coaching = coachSettings(state);
                    coaching.plans = [
                      ...(coaching.plans ?? []).filter((p) => p.id !== plan.id),
                      plan,
                    ];
                  }, "Your agreed plan is saved.");
                }
              } catch {
                setError("Check the fields and try again.");
              }
            }}
          >
            {tab === "memories" ? (
              <>
                <label>
                  Category
                  <select
                    name="category"
                    defaultValue={
                      typeof editor === "object" && "category" in editor
                        ? editor.category
                        : "preference"
                    }
                  >
                    {[
                      "preference",
                      "routine",
                      "food",
                      "equipment",
                      "boundary",
                      "other",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Remember this
                  <textarea
                    name="text"
                    required
                    maxLength={500}
                    rows={4}
                    defaultValue={
                      typeof editor === "object" && "text" in editor
                        ? editor.text
                        : ""
                    }
                    placeholder="I prefer quick vegetarian lunches."
                  />
                </label>
                <p className="fine-print">
                  Saving approves this exact preference for future Coach
                  conversations.
                </p>
              </>
            ) : (
              <>
                <label>
                  Something I want to try
                  <input
                    name="title"
                    required
                    maxLength={180}
                    defaultValue={
                      typeof editor === "object" && "title" in editor
                        ? editor.title
                        : ""
                    }
                  />
                </label>
                <label>
                  Details <small>(optional)</small>
                  <textarea
                    name="notes"
                    maxLength={500}
                    defaultValue={
                      typeof editor === "object" && "notes" in editor
                        ? editor.notes
                        : ""
                    }
                  />
                </label>
                <label>
                  Follow up when I visit from
                  <input
                    type="date"
                    name="followUpDate"
                    required
                    defaultValue={
                      typeof editor === "object" && "followUpDate" in editor
                        ? editor.followUpDate
                        : offsetDate(today(), 1)
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={
                      typeof editor === "object" && "status" in editor
                        ? editor.status
                        : "active"
                    }
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                </label>
                <label>
                  How it went <small>(optional)</small>
                  <textarea
                    name="outcome"
                    maxLength={500}
                    defaultValue={
                      typeof editor === "object" && "outcome" in editor
                        ? editor.outcome
                        : ""
                    }
                  />
                </label>
                <p className="fine-print">
                  Saving confirms this is your choice. You can revise or dismiss
                  it. No notifications are sent.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="notice warning">
                {error}
              </p>
            )}
            <Button type="submit" disabled={disabled || saving}>
              {saving
                ? "Saving…"
                : tab === "memories"
                  ? "Approve and save memory"
                  : "Save agreed plan"}
            </Button>
          </form>
        )}
      </Dialog>
    </section>
  );
}

export function AgreedPlans({
  journal,
  onAsk,
  disabled,
  onManage,
}: {
  journal: JournalController;
  onAsk: (question: string) => void;
  disabled: boolean;
  onManage: () => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const plans = (journal.state?.profile.coaching?.plans ?? [])
    .filter((p) => p.status === "active")
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  return (
    <section className="today-plans" aria-label="Your agreed plans">
      <div className="coach-section-title">
        <h2>Your agreed plans</h2>
        <button className="text-link" onClick={onManage}>
          Manage
        </button>
      </div>
      {plans.length === 0 ? (
        <p className="muted">
          No plan agreed yet. Choose one small next step with Coach when you’re
          ready.
        </p>
      ) : (
        plans.slice(0, 2).map((plan) => (
          <article className="coach-plan" key={plan.id}>
            <span className="eyebrow">
              {plan.followUpDate <= today()
                ? "Ready to reflect"
                : `Follow up from ${plan.followUpDate}`}
            </span>
            <h3>{plan.title}</h3>
            {plan.notes && <p>{plan.notes}</p>}
            <div className="button-row">
              <Button
                variant="secondary"
                disabled={disabled || saving}
                onClick={() =>
                  onAsk(
                    `Let’s discuss my agreed plan “${plan.title}”. Ask how it went before assuming an outcome; help me keep, revise or finish it.`,
                  )
                }
              >
                Discuss or revise
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || saving}
                onClick={async () => {
                  setSaving(true);
                  setError("");
                  try {
                    await journal.update((state) => {
                      const p = coachSettings(state).plans?.find(
                        (p) => p.id === plan.id,
                      );
                      if (p) {
                        p.status = "dismissed";
                        p.updatedAt = new Date().toISOString();
                      }
                    });
                  } catch {
                    setError("Could not dismiss the plan. Please try again.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Dismiss
              </Button>
            </div>
          </article>
        ))
      )}
      {plans.length > 2 && (
        <button className="text-link" onClick={onManage}>
          View all {plans.length} plans
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
