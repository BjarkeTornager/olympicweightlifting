"use client";

import { useState } from "react";
import { searchExercises } from "@/lib/exercises";

/** Native select keeps choosing exercises reliable on iPhone and with a keyboard. */
export function ExercisePicker({
  label,
  value,
  onChange,
  addImmediately = false,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  addImmediately?: boolean;
}) {
  const [query, setQuery] = useState("");
  const items = searchExercises(query);
  return (
    <div className="exercise-picker">
      <label>
        Find an exercise
        <input
          type="search"
          value={query}
          placeholder="Name, muscle or equipment…"
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
            {items.length ? "Choose exercise" : "No matching exercises"}
          </option>
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
        </select>
      </label>
      {!items.length && (
        <p className="fine-print" role="status">
          Try another name, muscle or equipment.
        </p>
      )}
    </div>
  );
}
