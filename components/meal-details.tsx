"use client";
import { totalNutrients, type Meal } from "@/lib/nutrition";
import { FoodTags } from "./food-tags";

const macros = (n: { protein: number; carbs: number; fat: number }) =>
  `P ${n.protein} g · C ${n.carbs} g · F ${n.fat} g`;

export function MealDetails({ meal }: { meal: Meal }) {
  const total = totalNutrients(meal.items);
  return (
    <div className="meal-details">
      <div className="meal-details-heading">
        <strong>{meal.name}</strong>
        <span className="meal-type-chip">{meal.type}</span>
      </div>
      <p className="meal-details-summary">
        <strong>{total.calories} kcal</strong> · {macros(total)} · {meal.date}
      </p>
      <ul className="meal-items">
        {meal.items.map((item, i) => (
          <li className="food-item-summary" key={i}>
            <span className="meal-item-name">
              {item.name}
              <small>{item.portion}</small>
            </span>
            <span className="meal-item-energy">
              {item.calories} kcal
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
