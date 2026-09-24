"use client";
import { today } from "@/lib/domain";
import {
  mealTypes,
  type DietTargets,
  type FoodItem,
  type Meal,
} from "@/lib/nutrition";
import { FoodTagEditor } from "./food-tags";
import { Button } from "./ui/button";

export const nutrientKeys = ["calories", "protein", "carbs", "fat"] as const;
export const nutrientLabel = {
  calories: "Calories (kcal)",
  protein: "Protein (g)",
  carbs: "Carbs (g)",
  fat: "Fat (g)",
};
const nutrientMax = { calories: 10000, protein: 1000, carbs: 2000, fat: 1000 };
export const blankFoodItem = (): FoodItem => ({
  name: "",
  portion: "",
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  classification: { foodGroups: [], ingredients: [] },
});

export function MealForm({
  meal: editor,
  error,
  onChange: setEditor,
  onSubmit,
}: {
  meal: Meal;
  error: string;
  onChange: (meal: Meal) => void;
  onSubmit: () => void;
}) {
  const updateItem = (index: number, patch: Partial<FoodItem>) =>
    setEditor({
      ...editor,
      items: editor.items.map((v, i) =>
        i === index ? ({ ...v, ...patch } as FoodItem) : v,
      ),
    });
  return (
    <form
      className="food-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {error && <p role="alert">{error}</p>}
      <label>
        Meal name
        <input
          required
          maxLength={160}
          value={editor.name}
          onChange={(e) => setEditor({ ...editor, name: e.target.value })}
        />
      </label>
      <div className="food-fields">
        <label>
          Meal date
          <input
            required
            type="date"
            max={today()}
            value={editor.date}
            onChange={(e) => setEditor({ ...editor, date: e.target.value })}
          />
        </label>
        <label>
          Meal type
          <select
            value={editor.type}
            onChange={(e) =>
              setEditor({
                ...editor,
                type: e.target.value as Meal["type"],
              })
            }
          >
            {mealTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
      </div>
      {editor.items.map((item, index) => (
        <fieldset key={index}>
          <legend>Food {index + 1}</legend>
          <label>
            Food name
            <input
              required
              value={item.name}
              maxLength={160}
              onChange={(e) => updateItem(index, { name: e.target.value })}
            />
          </label>
          <label>
            Portion
            <input
              required
              value={item.portion}
              maxLength={200}
              placeholder="150 g cooked / 1 medium bowl"
              onChange={(e) => updateItem(index, { portion: e.target.value })}
            />
          </label>
          <FoodTagEditor
            key={`${editor.id}:${index}:${item.name}:${item.portion}`}
            value={item.classification}
            onChange={(classification) => updateItem(index, { classification })}
          />
          <div className="food-fields">
            {nutrientKeys.map((key) => (
              <label key={key}>
                {nutrientLabel[key]}
                <input
                  required
                  type="number"
                  min={0}
                  step="0.1"
                  max={nutrientMax[key]}
                  value={item[key]}
                  onChange={(e) =>
                    updateItem(index, {
                      [key]:
                        e.target.value === "" ? "" : Number(e.target.value),
                    } as Partial<FoodItem>)
                  }
                />
              </label>
            ))}
          </div>
          {editor.items.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setEditor({
                  ...editor,
                  items: editor.items.filter((_, i) => i !== index),
                })
              }
            >
              Remove food {index + 1}
            </Button>
          )}
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={editor.items.length >= 30}
        onClick={() =>
          setEditor({ ...editor, items: [...editor.items, blankFoodItem()] })
        }
      >
        Add another food
      </Button>
      <label>
        Notes / portion assumptions
        <textarea
          value={editor.notes}
          maxLength={3000}
          onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
        />
      </label>
      <label className="food-check">
        <input
          type="checkbox"
          checked={editor.estimated}
          onChange={(e) =>
            setEditor({ ...editor, estimated: e.target.checked })
          }
        />{" "}
        Nutrition is estimated
      </label>
      {editor.photoIds.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setEditor({ ...editor, photoIds: [], source: "manual" })
          }
        >
          Remove photo links
        </Button>
      )}
      <Button type="submit">Save meal</Button>
    </form>
  );
}

export function DietTargetsForm({
  targets,
  onChange: setTargets,
  onSubmit,
}: {
  targets: DietTargets;
  onChange: (targets: DietTargets) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="food-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label>
        Diet goal
        <select
          value={targets.goal}
          onChange={(e) =>
            setTargets({
              ...targets,
              goal: e.target.value as typeof targets.goal,
            })
          }
        >
          <option value="maintain">Maintain weight</option>
          <option value="lose">Lose weight</option>
          <option value="gain">Gain weight</option>
        </select>
      </label>
      <div className="food-fields">
        {nutrientKeys.map((key) => (
          <label key={key}>
            {nutrientLabel[key]}
            <input
              type="number"
              min={0}
              step="0.1"
              max={nutrientMax[key]}
              value={targets[key] ?? ""}
              onChange={(e) =>
                setTargets({
                  ...targets,
                  [key]: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <p className="fine-print">
        The goal label does not calculate a calorie deficit or change your
        targets automatically.
      </p>
      <Button type="submit">Save targets</Button>
    </form>
  );
}
