"use client";
import { useState } from "react";
import { ArrowUpRight, Search } from "@/components/ui/icons";
import { EXERCISES } from "@/lib/domain";
import { Button } from "../ui/button";
import { Technique } from "../technique";
import {
  searchExercises,
  exerciseMuscles,
  exerciseEquipment,
} from "@/lib/exercises";
export function LibraryView() {
  const [query, setQuery] = useState("");
  const [discipline, setDiscipline] = useState("all");
  const [muscle, setMuscle] = useState("all");
  const [equipment, setEquipment] = useState("all");
  const items = searchExercises(query, { discipline, muscle, equipment });
  const filtered =
    query || discipline !== "all" || muscle !== "all" || equipment !== "all";
  const clear = () => {
    setQuery("");
    setDiscipline("all");
    setMuscle("all");
    setEquipment("all");
  };
  return (
    <>
      <div className="page-heading compact">
        <div>
          <h1>Exercises</h1>
          <p className="lead">
            Gym essentials and Olympic lifts, with technique videos and cues.
          </p>
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Training style">
        {[
          ["all", "All exercises"],
          ["gym", "Gym training"],
          ["olympic", "Olympic lifting"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={discipline === id}
            className={discipline === id ? "active" : ""}
            onClick={() => setDiscipline(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="picker-bar library-filters">
        <label className="search-field">
          <Search size={19} />
          <input
            type="search"
            aria-label="Search exercises"
            placeholder="Name, muscle or equipment…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Muscle group
          <select value={muscle} onChange={(e) => setMuscle(e.target.value)}>
            <option value="all">All muscles</option>
            {exerciseMuscles.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Equipment
          <select
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          >
            <option value="all">All equipment</option>
            {exerciseEquipment.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="section-top library-results">
        <p className="muted" role="status">
          {items.length} of {EXERCISES.length} exercises
        </p>
        {filtered && (
          <Button variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        )}
      </div>
      <div className="library-grid">
        {items.map((e) => (
          <article className="library-card" key={e.id}>
            <div className="library-card-main">
              <h2>{e.name}</h2>
              <p className="fine-print">
                {[e.category, ...e.equipment].join(", ")}
              </p>
            </div>
            <Technique exerciseId={e.id} />
            <details className="library-card-more">
              <summary>How to perform it</summary>
              <p className="muted">{e.purpose}</p>
              <ul className="cues">
                {e.cues.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {e.sourceUrl && (
                <a
                  className="text-link"
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {e.sourceName} guide <ArrowUpRight size={16} />
                </a>
              )}
            </details>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="empty">
          <h2>No exercises found.</h2>
          <p>Try a different name or clear a filter to see more movements.</p>
          <Button variant="secondary" onClick={clear}>
            Show all exercises
          </Button>
        </div>
      )}
    </>
  );
}
