"use client";

import { useRef, useState } from "react";
import { Camera, Images } from "./ui/icons";
import { Button } from "./ui/button";
import { uploadUserImage } from "@/lib/food-client";
import { today } from "@/lib/domain";
import { authorizeActivityPhoto } from "@/lib/activity-photo-client";
import { WhistleIcon } from "./ui/journal-icons";

export function ActivityPhotoUpload({
  accountId,
  go,
  showCoachLink = false,
}: {
  accountId?: string;
  go: (route: string) => void;
  showCoachLink?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploading = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const upload = async (file?: File) => {
    if (!file || !accountId || uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setError("");
    try {
      const image = await uploadUserImage(
        file,
        accountId,
        today(),
        "Activity photo",
        true,
      );
      authorizeActivityPhoto(accountId, image.id);
      go(`coach/photo/${image.id}/cardio/log`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not upload this image. Please retry.",
      );
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="panel activity-photo-upload"
      aria-label="Log activity from a photo"
      aria-busy={busy}
    >
      <div>
        <h2>Log activity from a photo</h2>
        <p className="muted">
          Photograph your treadmill or upload a walk, run or ride summary. Coach
          reads the details and saves your activity with Undo.
        </p>
      </div>
      <div className="button-row">
        <Button
          aria-label="Take activity photo"
          variant="secondary"
          disabled={busy || !accountId}
          onClick={() => camera.current?.click()}
        >
          <Camera size={18} /> Take photo
        </Button>
        <Button
          aria-label="Upload activity photo"
          variant="secondary"
          disabled={busy || !accountId}
          onClick={() => library.current?.click()}
        >
          <Images size={18} /> Upload photo
        </Button>
      </div>
      {showCoachLink && (
        <Button variant="ghost" onClick={() => go("coach/cardio")}>
          <WhistleIcon size={17} /> Log with Coach
        </Button>
      )}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Take activity photo"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        hidden
        aria-label="Upload activity photo"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className="fine-print" role="status">
        {busy
          ? "Saving your photo and opening Coach…"
          : "Private to your account. Images are sent to your Coach provider to read and tag. Missing measurements stay blank."}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
