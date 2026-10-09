"use client";

import { useState } from "react";
import {
  exerciseKey,
  newExerciseFor,
  ownExercises,
  searchExercises,
} from "@/lib/exercises";
import { cardioLabels, searchCardioActivities } from "@/lib/cardio";
import type { JournalState } from "@/lib/model";

/** Native select keeps choosing exercises reliable on iPhone and with a keyboard. */
export function ExercisePicker({
  label,
  value,
  onChange,
  state,
  addImmediately = false,
  includeActivities = false,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  // The athlete's journal, for their own exercises and a typed new one.
  state: JournalState;
  addImmediately?: boolean;
  includeActivities?: boolean;
}) {
  const [query, setQuery] = useState("");
  const items = searchExercises(query);
  const activities = includeActivities ? searchCardioActivities(query) : [];
  // Their own exercises with a word starting with each typed word.
  const words = exerciseKey(query).split(" ").filter(Boolean);
  const own = ownExercises(state).filter((e) => {
    const name = exerciseKey(e.id).split(" ");
    return words.every((w) => name.some((n) => n.startsWith(w)));
  });
  // Anything else typed can be saved as their own: offered after the
  // matches, so a library exercise with that name comes first.
  const fresh = newExerciseFor(state, query);
  const hasResults =
    items.length > 0 || activities.length > 0 || own.length > 0;
  return (
    <div className="exercise-picker">
      <label>
        {includeActivities
          ? "Find an exercise or activity"
          : "Find an exercise"}
        <input
          type="search"
          value={query}
          placeholder={
            includeActivities
              ? "Walking, bench press, cycling…"
              : "Name, muscle or equipment…"
          }
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange("");
          }}
        />
      </label>
      <label>
        {label}
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (addImmediately) setQuery("");
          }}
        >
          <option value="">
            {hasResults
              ? includeActivities
                ? "Choose exercise or activity"
                : "Choose exercise"
              : fresh
                ? "Not in the library yet"
                : includeActivities
                  ? "No matching exercises or activities"
                  : "No matching exercises"}
          </option>
          {own.length > 0 && (
            <optgroup label="Your exercises">
              {own.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          )}
          {activities.length > 0 && (
            <optgroup label="Cardio & movement">
              {activities.map((activity) => (
                <option key={activity} value={`activity:${activity}`}>
                  {cardioLabels[activity]}
                </option>
              ))}
            </optgroup>
          )}
          {[...new Set(items.map((e) => e.category))].sort().map((category) => (
            <optgroup key={category} label={category}>
              {items
                .filter((e) => e.category === category)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {fresh && (
            <optgroup label="New exercise">
              <option value={fresh.id}>
                Add “{fresh.name}” as a new exercise
              </option>
            </optgroup>
          )}
        </select>
      </label>
      {fresh ? (
        <p className="fine-print" role="status">
          {hasResults
            ? `Not in the list? The last choice adds “${fresh.name}” as a new exercise.`
            : `“${fresh.name}” isn’t in the library. Choose “Add as a new exercise” to save it as your own.`}
        </p>
      ) : (
        !hasResults && (
          <p className="fine-print" role="status">
            Try another name, muscle or equipment.
          </p>
        )
      )}
    </div>
  );
}
