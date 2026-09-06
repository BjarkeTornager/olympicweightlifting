import { z } from "zod";

export const imageCategorySchema = z.enum([
  "food",
  "sleep",
  "activity",
  "health",
  "other",
  "unclassified",
]);
export type ImageCategory = z.infer<typeof imageCategorySchema>;
export const imageCategories = imageCategorySchema.options;
export const imageCategoryLabel: Record<ImageCategory, string> = {
  food: "Food",
  sleep: "Sleep",
  activity: "Activity",
  health: "Health",
  other: "Other",
  unclassified: "Needs review",
};
export const imageTagsSchema = z
  .array(z.string().trim().min(1).max(32))
  .max(8)
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))]);
export type ImageClassification = {
  tags: string[];
  confidence: "high" | "medium" | "low";
  source: "automatic" | "manual" | "legacy";
  status: "pending" | "ready" | "review" | "failed";
};
export type UserImage = {
  id: string;
  label: string;
  date: string;
  createdAt: string;
  bytes: number;
  category: ImageCategory;
  classification: ImageClassification;
  version: number;
};
export const unclassifiedImage: ImageClassification = {
  tags: [],
  confidence: "low",
  source: "legacy",
  status: "review",
};
export const imagePatchSchema = z
  .object({
    category: imageCategorySchema,
    tags: imageTagsSchema,
    version: z.number().int().min(0),
  })
  .strict();
export function imageCoachPrompt(category: ImageCategory) {
  if (category === "food")
    return "Estimate the food in this image and prepare a food entry using its catalog date. Explain portion assumptions.";
  if (category === "sleep")
    return "Help me read this sleep screenshot. Explain only clearly visible information and ask about anything unclear. The upload date may differ from the sleep date. Do not save a check-in unless I ask.";
  return "Help me understand this image in the context of my journal. Identify what it shows first; do not assume it is food. Do not save an entry unless I ask.";
}
