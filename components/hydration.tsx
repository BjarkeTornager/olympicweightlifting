"use client";
import { useState } from "react";
import { today } from "@/lib/domain";
import {
  addDrink,
  formatLitres,
  hydrationForDay,
  removeDrink,
} from "@/lib/hydration";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { Droplets, Undo2 } from "./ui/icons";

// Today's drinks at a glance, with one-tap water: the easiest record to keep.
export function HydrationRow({ journal }: { journal: JournalController }) {
  const date = today();
  const day = hydrationForDay(journal.state!, date);
  const [last, setLast] = useState<{ id: string; ml: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const progress = Math.min(1, day.totalMl / day.targetMl);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that drink.");
    } finally {
      setBusy(false);
    }
  };
  const drink = (ml: number) =>
    run(async () => {
      let id = "";
      await journal.update((s) => {
        id = addDrink(s, { date, ml, kind: "water" }).id;
      });
      setLast({ id, ml });
    });
  return (
    <section className="list-card hydration-row" aria-label="Drinks today">
      <div className="list-row today-record">
        <Droplets size={22} />
        <span>
          <strong>Drinks</strong>
          <small>
            {day.recorded ? `${day.drinks.length || 1} logged` : "Nothing yet"}{" "}
            · aim for about {formatLitres(day.targetMl)}
          </small>
        </span>
        <span className="today-record-value">{formatLitres(day.totalMl)}</span>
      </div>
      <div
        className="hydration-progress"
        role="progressbar"
        aria-label="Drinks against today's target"
        aria-valuemin={0}
        aria-valuemax={day.targetMl}
        aria-valuenow={day.totalMl}
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="hydration-actions">
        {[250, 500].map((ml) => (
          <Button
            key={ml}
            variant="secondary"
            disabled={busy}
            onClick={() => void drink(ml)}
          >
            +{ml} ml water
          </Button>
        ))}
        {last && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await journal.update((s) => {
                  removeDrink(s, last.id);
                });
                setLast(null);
              })
            }
          >
            <Undo2 size={16} /> Undo {last.ml} ml
          </Button>
        )}
      </div>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
