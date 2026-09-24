"use client";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";
import { CoachPreferences } from "./coach-opening";

const destinations = [
  ["cardio", "Cardio & movement"],
  ["health", "Health history"],
  ["images", "Image library & categories"],
  ["workout/coaching", "Lifting brief & video"],
  ["workout/choose", "Programmes & routines"],
  ["library", "Exercise library"],
] as const;

export function CoachOptions({
  journal,
  preferencesKey,
  provider,
  disabled,
  showClear,
  clearDisabled,
  onOpenMemories,
  onClear,
  go,
}: {
  journal: JournalController;
  // Remounts preferences so reopening the dialog discards unsaved edits.
  preferencesKey: string;
  provider?: string | null;
  disabled: boolean;
  showClear: boolean;
  clearDisabled: boolean;
  onOpenMemories: () => void;
  onClear: () => void;
  go: (route: string) => void;
}) {
  return (
    <div className="coach-options">
      <Button variant="secondary" onClick={onOpenMemories}>
        What Coach remembers & agreed plans
      </Button>
      <CoachPreferences
        key={preferencesKey}
        journal={journal}
        disabled={disabled}
      />
      {destinations.map(([route, label]) => (
        <Button key={route} variant="secondary" onClick={() => go(route)}>
          {label}
        </Button>
      ))}
      <p className="fine-print">
        Coach can make mistakes. Your chat, attached images and relevant journal
        entries are sent to {provider ?? "your assistant provider"} when you ask
        for help. Saved images are also shared when you ask Coach to read or
        analyse them; simply showing a gallery does not share their pixels.{" "}
        <a href="/privacy">Read our privacy policy</a>.
      </p>
      {showClear && (
        <Button variant="ghost" disabled={clearDisabled} onClick={onClear}>
          Clear conversation
        </Button>
      )}
    </div>
  );
}
