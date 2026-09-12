"use client";

import { useState } from "react";
import { searchExercises } from "@/lib/exercises";
import { cardioLabels, searchCardioActivities } from "@/lib/cardio";

/** Native select keeps choosing exercises reliable on iPhone and with a keyboard. */
export function ExercisePicker({
  label,
  value,
  onChange,
  addImmediately = false,
  includeActivities = false,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  addImmediately?: boolean;
  includeActivities?: boolean;
}) {
  const [query, setQuery] = useState("");
  const items = searchExercises(query);
  const activities = includeActivities ? searchCardioActivities(query) : [];
  const hasResults = items.length > 0 || activities.length > 0;
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
              : includeActivities
                ? "No matching exercises or activities"
                : "No matching exercises"}
          </option>
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
        </select>
      </label>
      {!hasResults && (
        <p className="fine-print" role="status">
          Try another name, muscle or equipment.
        </p>
      )}
    </div>
  );
}
