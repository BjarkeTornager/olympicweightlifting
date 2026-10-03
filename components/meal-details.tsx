"use client";
import { totalNutrients, type Meal } from "@/lib/nutrition";
import { FoodTags } from "./food-tags";

// A figure stays with its letter and unit, and each dot with the figure
// before it, so a narrow column breaks only between macros.
const nb = "\u00a0";
const macros = (n: { protein: number; carbs: number; fat: number }) =>
  [
    `P${nb}${n.protein}${nb}g`,
    `C${nb}${n.carbs}${nb}g`,
    `F${nb}${n.fat}${nb}g`,
  ].join(`${nb}· `);

export function MealDetails({ meal }: { meal: Meal }) {
  const total = totalNutrients(meal.items);
  return (
    <div className="meal-details">
      <div className="meal-details-heading">
        <strong>{meal.name}</strong>
        <span className="meal-type-chip">{meal.type}</span>
      </div>
      <p className="meal-details-summary">
        <strong>{total.calories}&nbsp;kcal</strong>&nbsp;· {macros(total)}
        &nbsp;· <span className="whitespace-nowrap">{meal.date}</span>
      </p>
      <ul className="meal-items">
        {meal.items.map((item, i) => (
          <li className="food-item-summary" key={i}>
            <span className="meal-item-name">
              {item.name}
              <small>{item.portion}</small>
            </span>
            <span className="meal-item-energy">
              {item.calories}&nbsp;kcal
              <small>{macros(item)}</small>
            </span>
            <FoodTags value={item.classification} />
          </li>
        ))}
      </ul>
      <p className="fine-print">
        {meal.estimated ? "Estimated nutrition" : "Nutrition entered manually"}
        {meal.notes ? ` · ${meal.notes}` : ""}
      </p>
    </div>
  );
}
