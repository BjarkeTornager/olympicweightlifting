"use client";
import { useState } from "react";
import {
  foodGroups,
  ingredientEvidenceLabels,
  normalizeFoodTag,
  type FoodClassification,
} from "@/lib/nutrition";
export function FoodTags({ value }: { value?: FoodClassification }) {
  return (
    <div className="food-tags">
      {value?.foodGroups.map((group) => (
        <span className="food-group-tag" key={group}>
          {foodGroups[group]}
        </span>
      ))}
      {value?.ingredients.map((ingredient) => (
        <span key={ingredient.name} className="food-ingredient-tag">
          {ingredient.name}
          {ingredient.evidence !== "reported" && (
            <small> · {ingredientEvidenceLabels[ingredient.evidence]}</small>
          )}
        </span>
      ))}
      {!value?.ingredients.length && (
        <small className="muted">Ingredients not tagged</small>
      )}
    </div>
  );
}
export function FoodTagEditor({
  value = { foodGroups: [], ingredients: [] },
  onChange,
}: {
  value?: FoodClassification;
  onChange: (value: FoodClassification) => void;
}) {
  const [text, setText] = useState(
    value.ingredients.map((i) => i.name).join(", "),
  );
  return (
    <details className="food-tag-editor">
      <summary>Food groups &amp; ingredients</summary>
      <p className="fine-print">
        Tag what you know. Keep photo assumptions separate from ingredients you
        can confirm.
      </p>
      <fieldset className="food-group-options">
        <legend>Food groups</legend>
        {Object.entries(foodGroups).map(([group, label]) => (
          <label key={group} className="food-check">
            <input
              type="checkbox"
              checked={value.foodGroups.includes(
                group as keyof typeof foodGroups,
              )}
              onChange={(e) =>
                onChange({
                  ...value,
                  foodGroups: e.target.checked
                    ? [...value.foodGroups, group as keyof typeof foodGroups]
                    : value.foodGroups.filter((g) => g !== group),
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        Ingredient tags
        <input
          value={text}
          maxLength={3240}
          placeholder="chicken, rice, olive oil"
          onChange={(e) => {
            setText(e.target.value);
            const names = [
              ...new Set(
                e.target.value.split(",").map(normalizeFoodTag).filter(Boolean),
              ),
            ];
            onChange({
              ...value,
              ingredients: names.map(
                (name) =>
                  value.ingredients.find(
                    (i) => normalizeFoodTag(i.name) === name,
                  ) ?? { name, evidence: "reported" },
              ),
            });
          }}
        />
      </label>
      <p className="fine-print">
        Separate ingredients with commas. New tags are recorded as reported by
        you.
      </p>
      {value.ingredients.some((i) => i.evidence !== "reported") && (
        <div className="food-evidence-list">
          {value.ingredients
            .filter((i) => i.evidence !== "reported")
            .map((i) => (
              <label key={i.name}>
                {i.name}
                <select
                  aria-label={`Evidence for ${i.name}`}
                  value={i.evidence}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      ingredients: value.ingredients.map((v) =>
                        v.name === i.name
                          ? {
                              ...v,
                              evidence: e.target.value as typeof i.evidence,
                            }
                          : v,
                      ),
                    })
                  }
                >
                  {Object.entries(ingredientEvidenceLabels).map(
                    ([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
            ))}
        </div>
      )}
    </details>
  );
}
