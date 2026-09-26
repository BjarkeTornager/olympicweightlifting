"use client";
import { X } from "@/components/ui/icons";
import type { UserImage } from "@/lib/images";
import { Button } from "./ui/button";
import { FoodPhotoImage } from "./food-photo";
import { ImageBadge } from "./image-library";

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
