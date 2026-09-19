"use client";
import { useRef, useState } from "react";
import type { JournalController } from "./journal";
import { repeatMeal, type Meal, type FavouriteMeal } from "@/lib/nutrition";
import { today } from "@/lib/domain";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Camera, MessageCircle, Undo2 } from "./ui/icons";

export function QuickCapture({
  journal,
  open,
  onOpenChange,
  onDescribe,
  onPhoto,
  photoDisabled,
}: {
  journal: JournalController;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDescribe: () => void;
  onPhoto: (file: File) => void;
  photoDisabled: boolean;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [describe, setDescribe] = useState(false);
  const nutrition = journal.state!.nutrition;
  const candidates: (Meal | FavouriteMeal)[] = [
    ...(nutrition.favourites ?? []),
    ...[...nutrition.meals].reverse(),
  ];
  const meals = candidates
    .filter((m, i) => candidates.findIndex((n) => n.name === m.name) === i)
    .slice(0, 3);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Log something"
      description="A photo or a sentence is enough. You can correct it afterward."
      onCloseAutoFocus={(event) => {
        if (describe) {
          event.preventDefault();
          onDescribe();
          setDescribe(false);
        }
      }}
    >
      <div className="quick-capture-options">
        <label
          className={`food-upload quick-capture-photo ${photoDisabled ? "disabled" : ""}`}
        >
          <Camera size={22} /> Photograph my meal
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Photograph my meal"
            disabled={photoDisabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                onPhoto(file);
                setDescribe(true);
                onOpenChange(false);
              }
            }}
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setDescribe(true);
            onOpenChange(false);
          }}
        >
          <MessageCircle size={22} /> Type or dictate
        </Button>
      </div>
      <p className="fine-print">
        Use your keyboard’s microphone to describe food, sleep or training in
        one message.
      </p>
      {meals.length > 0 && (
        <section className="quick-repeat" aria-label="Repeat a meal">
          <h3>Had this again?</h3>
          <p className="fine-print">
            Adds the same portions to today. Tap only if you ate it.
          </p>
          {meals.map((meal) => (
            <div key={meal.id}>
              <span>
                <strong>{meal.name}</strong>
                <small>{meal.items.map((i) => i.portion).join(" · ")}</small>
              </span>
              <Button
                variant="secondary"
                aria-label={`I ate this: ${meal.name}`}
                disabled={saving || Boolean(journal.record?.conflict)}
                onClick={async () => {
                  if (inFlight.current) return;
                  inFlight.current = true;
                  setSaving(true);
                  setError("");
                  setNotice("");
                  try {
                    const entry = repeatMeal(meal, today());
                    await journal.update((state) => {
                      state.nutrition.meals.push(entry);
                      if (state.nutrition.completeDays)
                        state.nutrition.completeDays =
                          state.nutrition.completeDays.filter(
                            (date) => date !== entry.date,
                          );
                    });
                    setSavedId(entry.id);
                    setNotice(`${meal.name} added to today.`);
                  } catch {
                    setError("Could not add that meal. Please try again.");
                  } finally {
                    inFlight.current = false;
                    setSaving(false);
                  }
                }}
              >
                I ate this<span className="sr-only">: {meal.name}</span>
              </Button>
            </div>
          ))}
        </section>
      )}
      {notice && (
        <div role="status" className="notice">
          <span>{notice}</span>
          {savedId && journal.record?.undo && (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setError("");
                try {
                  await journal.update((state) => {
                    state.nutrition.meals = state.nutrition.meals.filter(
                      (m) => m.id !== savedId,
                    );
                  });
                  setSavedId(null);
                  setNotice("Meal undone.");
                } catch {
                  setError("Could not undo. Review the meal in Food.");
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Undo2 size={16} /> Undo meal
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <a
        href="#data"
        onClick={() => onOpenChange(false)}
        className="fine-print"
      >
        Set up reminders and Apple Health
      </a>
    </Dialog>
  );
}
