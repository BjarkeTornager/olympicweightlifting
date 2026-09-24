"use client";
import { useState } from "react";
import { ArrowUpRight, Play } from "@/components/ui/icons";
import { EXERCISES } from "@/lib/domain";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
export function Technique({ exerciseId }: { exerciseId: string }) {
  const [open, setOpen] = useState(false);
  const ex = EXERCISES.find((e) => e.id === exerciseId);
  if (!ex?.videoId)
    return (
      <span className="fine-print">
        Choose an exercise variation with your coach.
      </span>
    );
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Play size={16} />
        Technique
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={ex.name}
        description={ex.purpose}
      >
        <p className="fine-print">
          Instruction by {ex.sourceName}
          {ex.videoTitle ? ` · ${ex.videoTitle}` : ""}
        </p>
        <div className="video-frame">
          {open && (
            <iframe
              title={`${ex.name} technique demonstration`}
              src={`https://www.youtube-nocookie.com/embed/${ex.videoId}?rel=0&playsinline=1`}
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
        {ex.videoNote && <p className="fine-print">{ex.videoNote}</p>}
        <ul className="cues">
          {ex.cues.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="exercise-logging-note">
          <strong>How to log</strong> {ex.loggingNotes}
        </p>
        <div className="button-row">
          <Button asChild variant="secondary">
            <a
              href={`https://www.youtube.com/watch?v=${ex.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open YouTube <ArrowUpRight size={16} />
            </a>
          </Button>
          {ex.sourceUrl && (
            <a
              className="text-link"
              href={ex.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ex.sourceName} guide <ArrowUpRight size={16} />
            </a>
          )}
        </div>
      </Dialog>
    </>
  );
}
