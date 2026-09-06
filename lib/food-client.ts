import type { FoodPhoto } from "./nutrition";
export async function uploadFoodPhoto(
  file: File,
  accountId: string,
  date: string,
  label: string,
): Promise<FoodPhoto> {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024)
    throw Error("Choose an image smaller than 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw Error(
        "This photo format could not be opened. Choose a JPEG, PNG or WebP image.",
      );
    });
    const scale = Math.min(
      1,
      1280 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw Error("Photo processing is unavailable in this browser.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
    const response = await fetch("/api/food/photos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Journal-Account": accountId,
      },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        image: imageData,
        date,
        label: label.trim().slice(0, 160) || "Meal photo",
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error ?? "Could not save the photo. Please retry.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
