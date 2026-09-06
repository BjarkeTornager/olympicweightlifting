// Food-only compatibility surface. Generic uploads and health images use user-images.
import { ApiError } from "./agent/http";
import { listUserImages, readUserImage } from "./user-images";
export {
  normalizeImage as normalizeFoodPhoto,
  saveUserImage as saveFoodPhoto,
  deleteUserImage as deleteFoodPhoto,
  imageUploadSchema as photoUploadSchema,
} from "./user-images";
export const listFoodPhotos = (userId: string) =>
  listUserImages(userId, "food");
export async function readFoodPhoto(userId: string, id: string) {
  const image = await readUserImage(userId, id);
  if (image.category !== "food")
    throw new ApiError(
      "Only images categorised as Food can be linked to meals. Review the category in Images first.",
      422,
    );
  return image;
}
