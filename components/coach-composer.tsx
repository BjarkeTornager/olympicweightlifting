"use client";
import { Dumbbell, Moon, Utensils, X } from "@/components/ui/icons";
import { sleepLoggingPrompt, type UserImage } from "@/lib/images";
import { Button } from "./ui/button";
import { FoodPhotoImage } from "./food-photo";
import { ImageBadge } from "./image-library";

// Shortcuts that add a logging instruction to the draft; nothing is sent.
export function ComposerQuickActions({
  disabled,
  hasText,
  photoCount,
  onDraft,
}: {
  disabled: boolean;
  hasText: boolean;
  photoCount: number;
  onDraft: (text: string) => void;
}) {
  return (
    <div className="composer-quick-actions">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          onDraft(
            "Log what I ate with sensible portion estimates. Save it now, label assumptions, and let me correct details afterward.",
          )
        }
      >
        <Utensils size={16} /> <span>Log food</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          onDraft(
            hasText
              ? "Please use this to log my sleep. Ask about any unclear date or time asleep and save the entry."
              : sleepLoggingPrompt(photoCount > 0),
          )
        }
      >
        <Moon size={16} /> <span>Log sleep</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          onDraft(
            photoCount
              ? "Log my workout from the attached photo and any details I provided."
              : hasText
                ? "Please log this workout."
                : "Log my workout: ",
          )
        }
      >
        <Dumbbell size={16} /> <span>Add workout</span>
      </Button>
    </div>
  );
}

export function ComposerAttachments({
  photoIds,
  accountId,
  imageDetails,
  provider,
  onRemove,
}: {
  photoIds: string[];
  accountId: string;
  imageDetails: Record<string, UserImage>;
  provider?: string | null;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {photoIds.length > 4 && (
        <p className="error-text" role="alert">
          Choose up to four photos for this message. Remove an attachment to
          send.
        </p>
      )}
      <div className="coach-attachment-strip">
        {photoIds.map((id) => (
          <div key={id}>
            <FoodPhotoImage
              id={id}
              accountId={accountId}
              label="Image ready to send"
            />
            {imageDetails[id] && <ImageBadge image={imageDetails[id]} />}
            <Button
              type="button"
              variant="ghost"
              aria-label="Remove attachment"
              onClick={() => onRemove(id)}
            >
              <X size={16} />
            </Button>
          </div>
        ))}
      </div>
      <p className="fine-print">
        Attached images are shared with {provider ?? "your assistant provider"}{" "}
        when you send. Copies stay in your{" "}
        <a href="#images">private image library</a>.
      </p>
    </>
  );
}

// Why sending is unavailable, with a manual reconnect when it can help.
export function ComposerReconnect({
  hint,
  journalError,
  canReconnect,
  reconnecting,
  onReconnect,
}: {
  hint: string;
  journalError?: string;
  canReconnect: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
}) {
  return (
    <div className="coach-reconnect" role="status">
      <p className="fine-print">{hint}</p>
      {journalError && <p className="fine-print">{journalError}</p>}
      {canReconnect && (
        <Button
          type="button"
          variant="secondary"
          disabled={reconnecting}
          onClick={onReconnect}
        >
          {reconnecting ? "Reconnecting…" : "Reconnect Coach"}
        </Button>
      )}
    </div>
  );
}
