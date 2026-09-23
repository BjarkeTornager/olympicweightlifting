import type { ActionPreview } from "./agent/actions";
import type { SavedVisual } from "./coach-visuals";
import type { CoachUpdate } from "./coach-client";

export type Turn = {
  id: string;
  question: string;
  reply?: string;
  proposals?: ActionPreview[];
  status: string;
  photoIds?: string[];
  visuals?: SavedVisual[];
  activity?: string;
};

export const MAX_TURN_VISUALS = 3;

// Adds saved turns the client doesn't hold yet ahead of the local ones.
export function mergeSavedTurns(saved: Turn[], current: Turn[]) {
  return [
    ...saved.filter((t) => !current.some((v) => v.id === t.id)),
    ...current,
  ];
}

// Applies one streamed update: the reply so far, the current step, or a
// visual not yet shown. A turn shows at most three visuals.
export function applyStreamUpdate(turn: Turn, update: CoachUpdate): Turn {
  return {
    ...turn,
    ...(update.reply !== undefined ? { reply: update.reply } : {}),
    ...(update.activity ? { activity: update.activity } : {}),
    ...(update.visual &&
    !(turn.visuals ?? []).some((v) => v.id === update.visual!.id)
      ? {
          visuals: [...(turn.visuals ?? []), update.visual].slice(
            0,
            MAX_TURN_VISUALS,
          ),
        }
      : {}),
  };
}

// Records a saved or undone proposal. Undoing an entry Coach saved directly
// also replaces that turn's reply, which described the save.
export function markProposal(
  turns: Turn[],
  proposalId: string,
  status: ActionPreview["status"],
  undo: boolean,
): Turn[] {
  return turns.map((t) => ({
    ...t,
    ...(undo && t.proposals?.some((v) => v.id === proposalId && v.automatic)
      ? {
          reply:
            "Undone. Your journal has been restored to before this change.",
        }
      : {}),
    proposals: t.proposals?.map((v) =>
      v.id === proposalId ? { ...v, status } : v,
    ),
  }));
}
