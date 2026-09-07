import { normalizeFoodTag, type FoodItem } from "../nutrition";

/** Validate new proposals, without rewriting old journals or pending proposals. */
export function prepareFoodTags(
  items: FoodItem[],
  {
    previous = [],
    newMeal,
    viewedImages,
  }: {
    previous?: FoodItem[];
    newMeal: boolean;
    viewedImages: boolean;
  },
): FoodItem[] {
  return items.map((item) => {
    const originals = previous.filter(
      (old) => normalizeFoodTag(old.name) === normalizeFoodTag(item.name),
    );
    if (!item.classification) {
      if (newMeal || !originals.length)
        throw Error(
          `Include foodGroups and ingredient tags with evidence for “${item.name}”. Use the ingredients actually reported or observed. If they are unknown, use empty arrays and explain the uncertainty; never invent ingredients to fill tags.`,
        );
      return item;
    }
    const classification = {
      foodGroups: [...item.classification.foodGroups],
      ingredients: item.classification.ingredients.map((ingredient) => ({
        ...ingredient,
        name: normalizeFoodTag(ingredient.name),
      })),
    };
    for (const ingredient of classification.ingredients) {
      if (ingredient.evidence !== "visible" && ingredient.evidence !== "label")
        continue;
      const retained = originals.some((old) =>
        old.classification?.ingredients.some(
          (tag) =>
            normalizeFoodTag(tag.name) === ingredient.name &&
            tag.evidence === ingredient.evidence,
        ),
      );
      if (!viewedImages && !retained)
        throw Error(
          `“${ingredient.name}” cannot be marked as ${ingredient.evidence} without an image you have read. Use reported for what the person named, estimated for an explicit assumption, or inspect the relevant saved image before preparing the change. Library tags alone are not visual evidence.`,
        );
    }
    return { ...item, classification };
  });
}
