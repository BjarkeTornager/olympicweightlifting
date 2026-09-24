"use client";
import { LoaderCircle, Square } from "@/components/ui/icons";
import type { Turn } from "@/lib/coach-turns";
import { videoFeedbackLabel } from "@/lib/lifting-video";
import { FoodPhotoImage } from "./food-photo";
import { AssistantText } from "./assistant-text";
import { AguiVisuals } from "./agui-components";
import { CoachProposal } from "./coach-proposal";
import { WhistleIcon } from "./ui/journal-icons";

export type { Turn };

export function CoachTurn({
  turn: t,
  accountId,
  active,
  onStop,
  proposal,
}: {
  turn: Turn;
  accountId: string;
  // True while this turn is the run currently streaming.
  active: boolean;
  onStop: () => void;
  proposal: Omit<
    React.ComponentProps<typeof CoachProposal>,
    "proposal" | "accountId"
  >;
}) {
  return (
    <article className="conversation-turn">
      <div className="chat-user">
        <span className="sr-only">You: </span>
        {videoFeedbackLabel(t.question, t.photoIds?.length ?? 0) ?? t.question}
        <div className="food-photo-strip">
          {t.photoIds?.map((id) => (
            <FoodPhotoImage
              key={`${accountId}:${id}`}
              id={id}
              accountId={accountId}
              label="Attached image"
            />
          ))}
        </div>
      </div>
      {(t.reply || Boolean(t.visuals?.length)) && (
        <div className="chat-assistant">
          <span className="assistant-mark">
            <WhistleIcon size={16} /> Coach
          </span>
          {t.reply && <AssistantText text={t.reply} />}
          {Boolean(t.visuals?.length) && (
            <AguiVisuals visuals={t.visuals!} accountId={accountId} />
          )}
        </div>
      )}
      {t.status === "running" && (
        <div className="coach-run-activity">
          <p role="status">
            {active && <LoaderCircle size={15} aria-hidden="true" />}
            {active
              ? (t.activity ?? "Looking through your journal…")
              : "This request has not completed. You can ask again."}
          </p>
          {active && (
            <button onClick={onStop} aria-label="Stop response">
              <Square size={12} aria-hidden="true" />
              Stop
            </button>
          )}
        </div>
      )}
      {t.status === "failed" && (
        <p className="fine-print">
          This reply was interrupted. Reconnect to check its saved status.
        </p>
      )}
      {t.proposals?.map((p) => (
        <CoachProposal
          key={p.id}
          proposal={p}
          accountId={accountId}
          {...proposal}
        />
      ))}
    </article>
  );
}
