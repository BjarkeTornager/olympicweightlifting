"use client";
import { useState } from "react";
import { Plus, MessageCircle, Utensils } from "lucide-react";
import type { JournalController } from "../journal";
import { today, uid } from "@/lib/domain";
import {
  mealSchema,
  dietTargetsSchema,
  totalNutrients,
  nutritionSummary,
  findMeals,
  mealTypes,
  foodGroups,
  type Meal,
  type FoodItem,
} from "@/lib/nutrition";
import { FoodTags, FoodTagEditor } from "../food-tags";
import { ImageLibrary } from "../image-library";
import { FoodPhotoImage } from "../food-photo";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
const keys = ["calories", "protein", "carbs", "fat"] as const;
const nutrientLabel = {
  calories: "Calories (kcal)",
  protein: "Protein (g)",
  carbs: "Carbs (g)",
  fat: "Fat (g)",
};
const blankItem = (): FoodItem => ({
  name: "",
  portion: "",
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  classification: { foodGroups: [], ingredients: [] },
});
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
export function FoodView({
  journal,
  onLogin,
  go,
}: {
  journal: JournalController;
  onLogin: () => void;
  go: (route: string) => void;
}) {
  const nutrition = journal.state!.nutrition;
  const accountId = journal.identity?.id;
  const [date, setDate] = useState(today()),
    [editor, setEditor] = useState<Meal | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [targets, setTargets] = useState(nutrition.targets),
    [showTargets, setShowTargets] = useState(false);
  const [remove, setRemove] = useState<{ kind: "meal"; id: string } | null>(
    null,
  );
  const run = async (work: () => Promise<unknown>, message: string) => {
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    }
  };
  const [search, setSearch] = useState("");
  const [allDates, setAllDates] = useState(false);
  const [mealType, setMealType] = useState<"" | Meal["type"]>("");
  const [group, setGroup] = useState<"" | keyof typeof foodGroups>("");
  const filteredMeals = findMeals(nutrition.meals, {
    ...(allDates ? {} : { from: date, to: date }),
    ...(mealType ? { mealType } : {}),
    ...(group ? { foodGroup: group } : {}),
    ...(search.trim() ? { query: search.trim() } : {}),
  });
  const filterKey = JSON.stringify([allDates, date, mealType, group, search]);
  const [mealWindow, setMealWindow] = useState({ key: "", limit: 20 });
  const mealLimit = mealWindow.key === filterKey ? mealWindow.limit : 20;
  const meals = nutrition.meals.filter((m) => m.date === date);
  const totals = totalNutrients(meals.flatMap((m) => m.items));
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const week = nutritionSummary(
    nutrition,
    Number.isNaN(start.getTime()) ? date : start.toISOString().slice(0, 10),
    date,
  );
  return (
    <div className="food-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Utensils size={14} /> YOUR FOOD JOURNAL
          </div>
          <h1>Fuel your day.</h1>
          <p className="lead">
            Log a meal, photograph your plate or tell Coach what you ate.
          </p>
        </div>
        <Button onClick={() => go("coach")}>
          <MessageCircle size={17} /> Tell Coach what I ate
        </Button>
      </div>
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="food-toolbar">
        <label>
          Food date
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
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setTargets(nutrition.targets);
            setShowTargets(true);
          }}
        >
          Daily targets
        </Button>
        <Button
          onClick={() =>
            setEditor({
              id: uid(),
              name: "",
              date,
              type: "lunch",
              items: [blankItem()],
              source: "manual",
              estimated: false,
              notes: "",
              photoIds: [],
              createdAt: new Date().toISOString(),
            })
          }
        >
          <Plus size={17} /> Add meal manually
        </Button>
      </div>
      <div className="food-totals">
        {keys.map((key) => (
          <section className="panel" key={key}>
            <span className="muted">{nutrientLabel[key]}</span>
            <strong>{totals[key]}</strong>
            <span>
              {nutrition.targets[key] == null
                ? "No daily target"
                : `of ${nutrition.targets[key]}${key === "calories" ? " kcal" : " g"}`}
            </span>
            {nutrition.targets[key] != null && nutrition.targets[key]! > 0 && (
              <progress
                aria-label={`${key} toward target`}
                value={Math.min(totals[key], nutrition.targets[key]!)}
                max={nutrition.targets[key]!}
              />
            )}
            {nutrition.targets[key] != null && (
              <span className="fine-print">
                {Math.abs(Math.round(nutrition.targets[key]! - totals[key]))}{" "}
                {key === "calories" ? "kcal" : "g"}{" "}
                {totals[key] > nutrition.targets[key]!
                  ? "above target"
                  : "remaining"}
              </span>
            )}
          </section>
        ))}
      </div>
      <p className="fine-print">
        {meals.length
          ? `${meals.length} meals logged. Totals reflect recorded food only.`
          : "No meals logged for this date. This does not mean you ate nothing."}{" "}
        Diet goal: {nutrition.targets.goal} weight. Photo estimates depend on
        portions, ingredients and cooking fats.
      </p>
      <section className="panel">
        <h2>{allDates ? "Your meals" : `Meals · ${date}`}</h2>
        <div className="food-search-controls">
          <label>
            Search food or ingredients
            <input
              type="search"
              value={search}
              maxLength={160}
              placeholder="Try chicken, oats or a meal name"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Filter meal type
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value as typeof mealType)}
            >
              <option value="">All meals</option>
              {mealTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter food group
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value as typeof group)}
            >
              <option value="">All food groups</option>
              {Object.entries(foodGroups).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="food-check">
            <input
              type="checkbox"
              checked={allDates}
              onChange={(e) => setAllDates(e.target.checked)}
            />
            Search all logged dates
          </label>
        </div>
        <p className="fine-print" role="status">
          {filteredMeals.length} matching meals. Daily totals above always
          reflect {date}. Older foods may not have ingredient tags.
        </p>
        {!filteredMeals.length && (
          <p className="muted">
            No matching meals. Change the filters or log a meal with Coach.
          </p>
        )}
        {filteredMeals.slice(0, mealLimit).map((meal) => (
          <article className="food-meal" key={meal.id}>
            <MealDetails meal={meal} />
            <div className="food-photo-strip">
              {accountId &&
                meal.photoIds.map((id) => (
                  <FoodPhotoImage
                    key={`${accountId}:${id}`}
                    id={id}
                    accountId={accountId}
                    label={meal.name}
                  />
                ))}
            </div>
            <div className="button-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditor(structuredClone(meal))}
              >
                Edit meal
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRemove({ kind: "meal", id: meal.id })}
              >
                Delete meal
              </Button>
            </div>
          </article>
        ))}
      </section>
      {filteredMeals.length > mealLimit && (
        <Button
          variant="secondary"
          onClick={() =>
            setMealWindow({ key: filterKey, limit: mealLimit + 20 })
          }
        >
          Show more meals ({filteredMeals.length - mealLimit} remaining)
        </Button>
      )}
      <section className="panel">
        <h2>Last 7 days</h2>
        <p>
          {week.loggedDays} of 7 days have entries.{" "}
          {week.loggedDays
            ? `Average on logged days: ${Math.round(week.totals.calories / week.loggedDays)} kcal.`
            : "Log meals to see your pattern."}
        </p>
        <div className="food-week">
          {week.days.map((day) => (
            <button key={day.date} onClick={() => setDate(day.date)}>
              <span>{day.date.slice(5)}</span>
              <strong>{day.calories} kcal</strong>
              <small>{day.protein} g protein</small>
            </button>
          ))}
        </div>
        <p className="fine-print">
          Days with partial logging are included; this is not a measurement of
          your full intake.
        </p>
      </section>
      <ImageLibrary
        key={accountId ?? "guest"}
        accountId={accountId}
        onLogin={onLogin}
        go={go}
        scope="food"
        date={date}
      />
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={
          nutrition.meals.some((m) => m.id === editor?.id)
            ? "Edit meal"
            : "Add meal"
        }
        description="Enter portions and nutrition from labels, or correct the assistant’s estimates."
      >
        {editor && (
          <form
            className="food-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const meal = mealSchema.parse(editor);
                if (meal.date > today())
                  throw Error("Choose today or a past meal date.");
                await journal.update((s) => {
                  s.nutrition.meals = [
                    ...s.nutrition.meals.filter((m) => m.id !== meal.id),
                    meal,
                  ];
                });
                setEditor(null);
              }, "Meal saved to your journal.");
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
                  onChange={(e) =>
                    setEditor({ ...editor, date: e.target.value })
                  }
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
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        items: editor.items.map((v, i) =>
                          i === index ? { ...v, name: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Portion
                  <input
                    required
                    value={item.portion}
                    maxLength={200}
                    placeholder="150 g cooked / 1 medium bowl"
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        items: editor.items.map((v, i) =>
                          i === index ? { ...v, portion: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <FoodTagEditor
                  key={`${editor.id}:${index}:${item.name}:${item.portion}`}
                  value={item.classification}
                  onChange={(classification) =>
                    setEditor({
                      ...editor,
                      items: editor.items.map((v, i) =>
                        i === index ? { ...v, classification } : v,
                      ),
                    })
                  }
                />
                <div className="food-fields">
                  {keys.map((key) => (
                    <label key={key}>
                      {nutrientLabel[key]}
                      <input
                        required
                        type="number"
                        min={0}
                        step="0.1"
                        max={
                          key === "calories"
                            ? 10000
                            : key === "carbs"
                              ? 2000
                              : 1000
                        }
                        value={item[key]}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            items: editor.items.map((v, i) =>
                              i === index
                                ? ({
                                    ...v,
                                    [key]:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  } as FoodItem)
                                : v,
                            ),
                          })
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
                setEditor({ ...editor, items: [...editor.items, blankItem()] })
              }
            >
              Add another food
            </Button>
            <label>
              Notes / portion assumptions
              <textarea
                value={editor.notes}
                maxLength={3000}
                onChange={(e) =>
                  setEditor({ ...editor, notes: e.target.value })
                }
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
        )}
      </Dialog>
      <Dialog
        open={showTargets}
        onOpenChange={setShowTargets}
        title="Your daily targets"
        description="Choose targets that fit your own plan. Leave a field blank to track without a target."
      >
        <form
          className="food-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const value = dietTargetsSchema.parse(targets);
              await journal.update((s) => {
                s.nutrition.targets = value;
              });
              setShowTargets(false);
            }, "Daily targets saved.");
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
            {keys.map((key) => (
              <label key={key}>
                {nutrientLabel[key]}
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  max={
                    key === "calories" ? 10000 : key === "carbs" ? 2000 : 1000
                  }
                  value={targets[key] ?? ""}
                  onChange={(e) =>
                    setTargets({
                      ...targets,
                      [key]:
                        e.target.value === "" ? null : Number(e.target.value),
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
      </Dialog>
      <Dialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title={`Delete ${remove?.kind ?? "entry"}?`}
        description={
          remove?.kind === "meal"
            ? "Removes this meal from your daily totals. Its photos stay in your library."
            : "Removes this photo from your private library. Download a copy first if you want to keep it."
        }
      >
        <Button
          type="button"
          variant="danger"
          onClick={() =>
            void run(async () => {
              if (!remove) return;
              if (remove.kind === "meal")
                await journal.update((s) => {
                  s.nutrition.meals = s.nutrition.meals.filter(
                    (m) => m.id !== remove.id,
                  );
                });
              setRemove(null);
            }, "Entry deleted.")
          }
        >
          Delete {remove?.kind}
        </Button>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    </div>
  );
}
