"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { privateFetch } from "@/lib/private-fetch";
import { foodDate } from "@/lib/nutrition";
import { imageCategoryLabel, imageCategorySchema } from "@/lib/images";
import { FoodPhotoImage } from "./food-photo";

const metadataSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(160),
  date: foodDate,
  category: imageCategorySchema,
});
type Metadata = z.infer<typeof metadataSchema>;

function GalleryPhoto({ id, accountId }: { id: string; accountId: string }) {
  const [loaded, setLoaded] = useState<{
    key: string;
    image?: Metadata;
  } | null>(null);
  const key = `${accountId}:${id}`;
  useEffect(() => {
    const controller = new AbortController();
    privateFetch(`/api/images/${encodeURIComponent(id)}?metadata=1`, {
      headers: { "X-Journal-Account": accountId },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("unavailable");
        const image = metadataSchema.parse(await response.json());
        if (image.id !== id) throw Error("unavailable");
        if (!controller.signal.aborted) setLoaded({ key, image });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key });
      });
    return () => controller.abort();
  }, [id, accountId, key]);
  const image = loaded?.key === key ? loaded.image : undefined;
  if (!image)
    return (
      <li className="coach-photo-unavailable">
        {loaded?.key === key
          ? "This photo is no longer available. It may have been deleted, or your connection changed."
          : "Loading your photo…"}
      </li>
    );
  const detail = `${imageCategoryLabel[image.category]} · ${image.date}`;
  return (
    <li className="coach-photo-card">
      <FoodPhotoImage
        id={id}
        accountId={accountId}
        label={image.label}
        description={detail}
      />
      <strong>{image.label}</strong>
      <small>{detail}</small>
    </li>
  );
}

export function CoachPhotoGallery({
  imageIds,
  accountId,
}: {
  imageIds: string[];
  accountId: string;
}) {
  return (
    <ul
      className="coach-photo-gallery"
      aria-label="Photos from your private library"
    >
      {imageIds.map((id) => (
        <GalleryPhoto
          key={`${accountId}:${id}`}
          id={id}
          accountId={accountId}
        />
      ))}
    </ul>
  );
}
