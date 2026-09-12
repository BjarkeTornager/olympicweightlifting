"use client";
import { privateFetch } from "@/lib/private-fetch";
import { useEffect, useRef, useState } from "react";
import { Expand } from "./ui/icons";
import { Dialog } from "./ui/dialog";
export function FoodPhotoImage({
  id,
  accountId,
  label,
  download = false,
  preview = true,
  description,
}: {
  id: string;
  accountId: string;
  label: string;
  download?: boolean;
  preview?: boolean;
  description?: string;
}) {
  const key = `${accountId}:${id}`;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const thumbnail = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState<{ key: string; url?: string } | null>(
    null,
  );
  const url = loaded?.key === key ? loaded.url : undefined;
  const failed = loaded?.key === key && !loaded.url;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    privateFetch(`/api/images/${encodeURIComponent(id)}`, {
      headers: { "X-Journal-Account": accountId },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("unavailable");
        return r.blob();
      })
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ key, url: objectUrl });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, id, key]);
  // Private, authenticated blobs bypass the public image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  const photo = url && <img src={url} alt={label} width={320} height={240} />;
  return (
    <div className="food-photo-image">
      {url ? (
        <>
          {preview ? (
            <button
              ref={thumbnail}
              type="button"
              className="photo-thumbnail"
              aria-label={`Open photo: ${label}`}
              aria-haspopup="dialog"
              onClick={() => setOpenKey(key)}
            >
              {photo}
              <span className="photo-expand" aria-hidden="true">
                <Expand size={17} />
              </span>
            </button>
          ) : (
            photo
          )}
          {download && (
            <a href={url} download={`image-${id}.jpg`}>
              Download photo
            </a>
          )}
          {preview && (
            <Dialog
              open={openKey === key}
              onOpenChange={(open) => setOpenKey(open ? key : null)}
              className="photo-viewer"
              title={label}
              description={description}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                thumbnail.current?.focus({ preventScroll: true });
              }}
            >
              <div className="photo-viewer-content">
                {/* Recheck access when opened. Full-size blobs live only as long as the viewer. */}
                <FoodPhotoImage
                  key={key}
                  id={id}
                  accountId={accountId}
                  label={label}
                  preview={false}
                  download
                />
              </div>
            </Dialog>
          )}
        </>
      ) : (
        <span className="muted">
          {failed
            ? "Photo unavailable. Connect to the internet or check your account."
            : "Loading photo…"}
        </span>
      )}
    </div>
  );
}
