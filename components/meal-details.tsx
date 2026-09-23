"use client";
import { totalNutrients, type Meal } from "@/lib/nutrition";
import { FoodTags } from "./food-tags";

export function MealDetails({ meal }: { meal: Meal }) {
  const total = totalNutrients(meal.items);
  return (
    <div className="meal-details">
      <p>
        <strong>{meal.name}</strong> · {meal.date} · {meal.type}
      </p>
      {meal.items.map((item, i) => (
        <div className="food-item-summary" key={i}>
          <span>
            {item.name} · {item.portion}
          </span>
          <span>
            {item.calories} kcal · P {item.protein} g · C {item.carbs} g · F{" "}
            {item.fat} g
          </span>
          <FoodTags value={item.classification} />
        </div>
      ))}
      <p>
        <strong>{total.calories} kcal</strong> · {total.protein} g protein ·{" "}
        {total.carbs} g carbs · {total.fat} g fat
      </p>
      <p className="fine-print">
        {meal.estimated ? "Estimated nutrition" : "Nutrition entered manually"}
        {meal.notes ? ` · ${meal.notes}` : ""}
      </p>
    </div>
  );
}
