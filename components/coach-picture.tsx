"use client";
import { useEffect, useRef, useState } from "react";
import { privateFetch } from "@/lib/private-fetch";
import { Dialog } from "./ui/dialog";
import { Expand, Sparkles } from "./ui/icons";

// How often a picture still being drawn is asked for, and for how long.
const RETRY_MS = 1500;
const PATIENCE_MS = 45000;

/** What a reply means for a picture: shown at 200, asked for again while it
 * is drawn (202) or the server is busy or briefly away, gone otherwise. */
export function pictureOutcome(status: number): "ready" | "drawing" | "gone" {
  if (status === 200) return "ready";
  if (status === 0 || status === 202 || status === 429 || status >= 500)
    return "drawing";
  return "gone";
}

// A picture of a dish Coach drew for a recipe card, fetched with the
// athlete's session. It is drawn after the card appears, so this asks again
// every second and a half while it is being drawn, for up to 45 seconds. It
// is always marked as an AI picture; clicking it opens it larger.
export function CoachPicture({
  id,
  accountId,
  title,
}: {
  id: string;
  accountId: string;
  title: string;
}) {
  const key = `${accountId}:${id}`;
  const [loaded, setLoaded] = useState<{ key: string; url?: string } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const thumbnail = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let objectUrl = "";
    const until = Date.now() + PATIENCE_MS;
    const wait = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, RETRY_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    const ask = async () => {
      while (!signal.aborted) {
        const response = await privateFetch(
          `/api/coach/pictures/${encodeURIComponent(id)}`,
          { headers: { "X-Journal-Account": accountId }, signal },
        ).catch(() => undefined);
        const outcome = pictureOutcome(response?.status ?? 0);
        if (outcome === "ready") {
          const blob = await response!.blob();
          if (signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          return setLoaded({ key, url: objectUrl });
        }
        void response?.body?.cancel().catch(() => {});
        if (outcome === "gone" || Date.now() >= until)
          return setLoaded({ key });
        await wait();
      }
    };
    ask().catch(() => {
      if (!signal.aborted) setLoaded({ key });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, id, key]);
  const url = loaded?.key === key ? loaded.url : undefined;
  if (loaded?.key === key && !url)
    return <p className="coach-picture-unavailable">Picture unavailable</p>;
  const label = `AI picture of ${title}`;
  return (
    <div className="coach-picture">
      {url ? (
        <button
          ref={thumbnail}
          type="button"
          className="photo-thumbnail"
          aria-label={`Open the ${label}`}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {/* Private, authenticated blobs bypass the public image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} width={1024} height={768} />
          <span className="photo-expand" aria-hidden="true">
            <Expand size={17} />
          </span>
        </button>
      ) : (
        <div className="coach-picture-drawing" role="status">
          <Sparkles size={18} aria-hidden="true" />
          Drawing a picture…
        </div>
      )}
      <span className="coach-picture-badge" aria-hidden="true">
        AI picture
      </span>
      {url && (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          className="photo-viewer"
          title={title}
          description="An AI picture of the dish, not a photo of a meal."
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            thumbnail.current?.focus({ preventScroll: true });
          }}
        >
          <div className="photo-viewer-content food-photo-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={label} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
