"use client";
import { useEffect, useState } from "react";
import { Camera, Images, RefreshCw } from "lucide-react";
import { today } from "@/lib/domain";
import { uploadUserImage } from "@/lib/food-client";
import {
  imageCategories,
  imageCategoryLabel,
  type ImageCategory,
  type UserImage,
} from "@/lib/images";
import { FoodPhotoImage } from "./food-photo";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function ImageBadge({ image }: { image: UserImage }) {
  return (
    <span className={`image-category image-category-${image.category}`}>
      {imageCategoryLabel[image.category]}
      <small>
        {image.classification.status === "failed"
          ? "Tagging unavailable"
          : image.classification.status === "pending"
            ? "Tagging pending"
            : image.classification.source === "manual"
              ? "Tagged by you"
              : image.classification.status === "ready"
                ? "Auto tagged"
                : "Review category"}
      </small>
    </span>
  );
}

export function ImageLibrary({
  accountId,
  onLogin,
  go,
  scope = "all",
  date: suppliedDate,
}: {
  accountId?: string;
  onLogin: () => void;
  go: (route: string) => void;
  scope?: "all" | "food" | "health";
  date?: string;
}) {
  const [images, setImages] = useState<UserImage[]>([]);
  const [filter, setFilter] = useState<ImageCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(today());
  const [label, setLabel] = useState("");
  const [autoTag, setAutoTag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(accountId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [limit, setLimit] = useState(12);
  const [editor, setEditor] = useState<UserImage | null>(null);
  const [tags, setTags] = useState("");
  const [remove, setRemove] = useState<UserImage | null>(null);
  const uploadDate = suppliedDate ?? date;
  const LibraryHeading = scope === "all" ? "h1" : "h2";
  useEffect(() => {
    if (!accountId) return;
    const abort = new AbortController();
    fetch(`/api/images${scope === "food" ? "?category=food" : ""}`, {
      headers: { "X-Journal-Account": accountId },
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error ?? "Image library unavailable.");
        if (!abort.signal.aborted) setImages(data.images);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [accountId, refresh, scope]);
  const request = async (
    id: string,
    method: string,
    body?: unknown,
    suffix = "",
  ) => {
    const response = await fetch(`/api/images/${id}${suffix}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Journal-Account": accountId!,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? "Could not update the image.");
    return data;
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const replace = (image: UserImage) =>
    setImages((old) => [image, ...old.filter((p) => p.id !== image.id)]);
  const upload = (file?: File) => {
    if (!file || !accountId) return;
    void run(async () => {
      const image = await uploadUserImage(
        file,
        accountId,
        uploadDate,
        label,
        autoTag,
      );
      replace(image);
      setNotice(
        image.category === "unclassified"
          ? "Image saved in Needs review. Choose a category in the image library."
          : `Photo saved to your account under ${imageCategoryLabel[image.category]}.`,
      );
    });
  };
  const inScope = (image: UserImage) =>
    scope === "all" ||
    (scope === "food"
      ? image.category === "food"
      : ["sleep", "activity", "health"].includes(image.category));
  const scoped = images.filter(inScope);
  const visible = scoped.filter(
    (image) =>
      (filter === "all" || image.category === filter) &&
      `${image.label} ${image.date} ${image.classification.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const categories =
    scope === "health"
      ? (["sleep", "activity", "health"] as const)
      : imageCategories;
  return (
    <section
      className="panel image-library"
      aria-label={scope === "food" ? "Meal image library" : "Image library"}
    >
      <div className="section-heading">
        <LibraryHeading>
          <Images size={20} />{" "}
          {scope === "food"
            ? "Your meal photos"
            : scope === "health"
              ? "Health images & screenshots"
              : "Your image library"}
        </LibraryHeading>
        <span>{scoped.length} images</span>
      </div>
      <p className="muted">
        {scope === "food"
          ? "Only images categorised as Food appear here. Sleep and health screenshots have their own collections."
          : scope === "health"
            ? "Sleep reports, activity screenshots and health images, organised in your account."
            : "Meals, sleep reports and health screenshots, organised by what they show."}
      </p>
      {scope !== "all" && (
        <Button variant="ghost" onClick={() => go("images")}>
          All images & category review →
        </Button>
      )}
      {!accountId ? (
        <Button onClick={onLogin}>Sign in to save images</Button>
      ) : (
        <>
          <div className="image-upload-area">
            <div className="food-toolbar">
              {!suppliedDate && (
                <label>
                  Image date
                  <input
                    type="date"
                    value={date}
                    max={today()}
                    required
                    onChange={(e) => {
                      if (e.target.value) setDate(e.target.value);
                    }}
                  />
                </label>
              )}
              <label>
                Photo label
                <input
                  value={label}
                  maxLength={160}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Optional description"
                />
              </label>
              <label className="food-upload">
                <Camera size={17} /> Take photo
                <input
                  type="file"
                  aria-label="Take photo"
                  accept="image/*"
                  capture="environment"
                  disabled={busy}
                  onChange={(e) => {
                    upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="food-upload">
                Upload image
                <input
                  type="file"
                  aria-label="Upload image"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <label className="image-auto-tag">
              <input
                type="checkbox"
                checked={autoTag}
                onChange={(e) => setAutoTag(e.target.checked)}
                disabled={busy}
              />{" "}
              Tag automatically
            </label>
            <p className="fine-print">
              With automatic tagging on, each upload is sent to your configured
              assistant provider to identify its category and tags. You can
              correct them. Turn it off to save privately in Needs review.
              Upload date: {uploadDate}; this may differ from a date shown in a
              screenshot.
            </p>
            {busy && <p role="status">Saving image or updating tags…</p>}
          </div>
          {notice && (
            <div role="status" className="notice">
              {notice}{" "}
              {scope !== "all" && (
                <button onClick={() => go("images")}>Open image library</button>
              )}
            </div>
          )}
          {error && (
            <div role="alert" className="notice warning">
              {error}
            </div>
          )}
          {scope !== "food" && (
            <div className="image-filters" aria-label="Image categories">
              {(["all", ...categories] as const).map((category) => (
                <button
                  key={category}
                  aria-pressed={filter === category}
                  onClick={() => {
                    setFilter(category);
                    setLimit(12);
                  }}
                >
                  {category === "all" ? "All" : imageCategoryLabel[category]}{" "}
                  <span>
                    {
                      scoped.filter(
                        (i) => category === "all" || i.category === category,
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="food-toolbar">
            <label>
              Search photo library
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(12);
                }}
                placeholder="Label, tag or date"
              />
            </label>
            <Button
              variant="ghost"
              disabled={busy || loading}
              onClick={() => {
                setError("");
                setLoading(true);
                setRefresh((v) => v + 1);
              }}
            >
              <RefreshCw size={16} /> Refresh library
            </Button>
          </div>
          {loading && <p role="status">Loading images…</p>}
          {!loading && !visible.length && (
            <p className="image-empty">No images in this collection yet.</p>
          )}
          <div className="food-photo-grid">
            {visible.slice(0, limit).map((image) => (
              <article key={image.id}>
                <FoodPhotoImage
                  id={image.id}
                  accountId={accountId}
                  label={image.label}
                  download
                />
                <ImageBadge image={image} />
                <strong>{image.label}</strong>
                <span>{image.date}</span>
                <div className="image-tags">
                  {image.classification.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => go(`coach/photo/${image.id}`)}
                >
                  {image.category === "food"
                    ? "Estimate meal"
                    : image.category === "sleep"
                      ? "Read sleep image"
                      : "Discuss with Coach"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditor(image);
                    setTags(image.classification.tags.join(", "));
                    setError("");
                  }}
                >
                  Edit category & tags
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next: UserImage = await request(
                        image.id,
                        "POST",
                        { version: image.version },
                        "/classify",
                      );
                      replace(next);
                      setNotice(
                        next.classification.status === "failed"
                          ? "Image kept. Automatic tagging is unavailable; choose its category manually."
                          : `Category: ${imageCategoryLabel[next.category]}.`,
                      );
                    })
                  }
                >
                  Retag automatically
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setRemove(image);
                    setError("");
                  }}
                >
                  Delete photo
                </Button>
              </article>
            ))}
          </div>
          {visible.length > limit && (
            <Button variant="secondary" onClick={() => setLimit((v) => v + 12)}>
              Show more images
            </Button>
          )}
          {scope === "all" && (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => {
                const blob = new Blob(
                  [
                    JSON.stringify(
                      {
                        schemaVersion: 1,
                        exportedAt: new Date().toISOString(),
                        images,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob),
                  link = document.createElement("a");
                link.href = url;
                link.download = `image-catalog-${today()}.json`;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export image catalog
            </Button>
          )}
          <p className="fine-print">
            Images and tags are private to your account. Download images from
            their cards. Up to 1,000 images or 250 MB per account. Tagging
            organises files; it does not log meals or health measurements.
          </p>
        </>
      )}
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
        title="Edit image category"
        description="Your choice takes priority over automatic tags. Meal-linked images must be unlinked in Food before moving to another category."
      >
        {editor && (
          <form
            className="food-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const next: UserImage = await request(editor.id, "PATCH", {
                  category: editor.category,
                  tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  version: editor.version,
                });
                replace(next);
                setEditor(null);
                setNotice(
                  `Image saved under ${imageCategoryLabel[next.category]}.`,
                );
              });
            }}
          >
            <label>
              Category
              <select
                aria-label="Category"
                value={editor.category}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    category: e.target.value as ImageCategory,
                  })
                }
              >
                {imageCategories.map((category) => (
                  <option key={category} value={category}>
                    {imageCategoryLabel[category]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tags
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                maxLength={270}
                placeholder="sleep report, apple health, screenshot"
              />
            </label>
            <p className="fine-print">
              Up to eight tags, separated by commas; 32 characters per tag.
            </p>
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy}>Save category</Button>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null);
        }}
        title="Delete this image?"
        description="Download a copy first if you want to keep it. This removes the image and its tags from your account."
      >
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await request(remove!.id, "DELETE");
              setImages((old) => old.filter((i) => i.id !== remove!.id));
              setRemove(null);
              setNotice("Image deleted.");
            })
          }
        >
          Delete photo
        </Button>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    </section>
  );
}
