"use client";
import { useState } from "react";
import { today } from "@/lib/domain";
import {
  addSupplement,
  removeSupplement,
  supplementText,
  supplementsForDay,
} from "@/lib/supplements";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Pill, Plus, X } from "./ui/icons";

// Today's vitamins and supplements: usual ones are one tap, anything else is
// a name and an optional amount.
export function SupplementsRow({ journal }: { journal: JournalController }) {
  const date = today();
  const day = supplementsForDay(journal.state!, date);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save that supplement.",
      );
    } finally {
      setBusy(false);
    }
  };
  const take = (supplement: { name: string; amount: string }) =>
    run(() =>
      journal.update((s) => {
        addSupplement(s, { date, ...supplement });
      }),
    );
  return (
    <section
      className="list-card hydration-row supplements-row"
      aria-label="Supplements today"
    >
      <div className="list-row today-record">
        <Pill size={22} />
        <span>
          <strong>Supplements</strong>
          <small>
            {day.taken.length
              ? `${day.taken.length} taken`
              : day.usual.length
                ? "Tap your usual ones when you take them"
                : "Vitamins, creatine, fish oil…"}
          </small>
        </span>
      </div>
      {day.taken.length > 0 && (
        <ul className="supplement-chips" aria-label="Taken today">
          {day.taken.map((s) => (
            <li key={s.id}>
              <span>{supplementText(s)}</span>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    journal.update((state) => {
                      removeSupplement(state, s.id);
                    }),
                  )
                }
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="hydration-actions">
        {day.usual.map((s) => (
          <Button
            key={s.name}
            variant="secondary"
            disabled={busy}
            onClick={() => void take(s)}
          >
            <Plus size={16} /> {supplementText(s)}
          </Button>
        ))}
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add supplement
          </Button>
        )}
      </div>
      {adding && (
        <form
          className="supplement-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              await journal.update((s) => {
                addSupplement(s, { date, name, amount });
              });
              setName("");
              setAmount("");
              setAdding(false);
            });
          }}
        >
          <label>
            Name
            <input
              value={name}
              maxLength={80}
              required
              autoFocus
              placeholder="Vitamin D"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Amount <small>optional</small>
            <input
              value={amount}
              maxLength={40}
              placeholder="1000 IU"
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className="button-row">
            <Button type="submit" disabled={busy || !name.trim()}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
