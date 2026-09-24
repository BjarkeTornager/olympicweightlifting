"use client";
import { Camera } from "@/components/ui/icons";
import { Button } from "./ui/button";

export function CoachImageTools({
  signedIn,
  uploading,
  loadingImage,
  attachmentsFull,
  autoTag,
  provider,
  onAutoTagChange,
  onAttach,
  onClose,
  onLogActivity,
  onReviewVideo,
}: {
  signedIn: boolean;
  uploading: boolean;
  loadingImage: boolean;
  attachmentsFull: boolean;
  autoTag: boolean;
  provider?: string | null;
  onAutoTagChange: (autoTag: boolean) => void;
  onAttach: (files: File | File[] | undefined) => void;
  onClose: () => void;
  onLogActivity: () => void;
  onReviewVideo: () => void;
}) {
  const uploadDisabled =
    uploading || loadingImage || !signedIn || attachmentsFull;
  return (
    <div id="coach-image-tools" className="coach-image-tools">
      <div className="food-attachments">
        <label className="food-upload">
          <Camera size={17} /> {uploading ? "Saving & tagging…" : "Take photo"}
          <input
            type="file"
            aria-label="Take photo"
            accept="image/*"
            capture="environment"
            disabled={uploadDisabled}
            onChange={(e) => {
              onAttach(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <label className="food-upload">
          Attach image
          <input
            type="file"
            aria-label="Attach image"
            multiple
            accept="image/*"
            disabled={uploadDisabled}
            onChange={(e) => {
              onAttach(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="coach-image-more">
        <a href="#images" onClick={onClose}>
          Image library & categories
        </a>
        <Button
          type="button"
          variant="ghost"
          disabled={uploading || loadingImage}
          onClick={onLogActivity}
        >
          Log walk, run or ride
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!signedIn || uploading || loadingImage}
          onClick={onReviewVideo}
        >
          Review lifting video
        </Button>
      </div>
      {attachmentsFull && (
        <p className="fine-print" role="status">
          Four photos are attached. Send this message or remove an attachment to
          add another.
        </p>
      )}
      {!signedIn && (
        <p className="fine-print" role="status">
          Sign in to attach private photos.
        </p>
      )}
      <label className="image-auto-tag">
        <input
          type="checkbox"
          checked={autoTag}
          disabled={uploading}
          onChange={(e) => onAutoTagChange(e.target.checked)}
        />{" "}
        Tag uploads automatically
      </label>
      <p className="fine-print">
        Automatic tagging sends each new image to{" "}
        {provider ?? "your configured assistant provider"} to identify food,
        sleep, activity or other content. Turn it off to save in Needs review.
        No journal entry is created by tagging.
      </p>
    </div>
  );
}
