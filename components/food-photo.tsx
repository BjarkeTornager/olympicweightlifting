"use client";
import { useEffect, useState } from "react";
export function FoodPhotoImage({
  id,
  accountId,
  label,
  download = false,
}: {
  id: string;
  accountId: string;
  label: string;
  download?: boolean;
}) {
  const [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    fetch(`/api/food/photos/${encodeURIComponent(id)}`, {
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
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, id]);
  return (
    <div className="food-photo-image">
      {url ? (
        <>
          {/* Private, authenticated blobs must bypass the public image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} width={320} height={240} />
          {download && (
            <a href={url} download={`meal-${id}.jpg`}>
              Download photo
            </a>
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
