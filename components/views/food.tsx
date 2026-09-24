"use client";
import { useState } from "react";
import { Plus, MessageCircle, Flame } from "@/components/ui/icons";
import { AreaIcon } from "../ui/area-icon";
import type { JournalController } from "../journal";
import { today, uid } from "@/lib/domain";
import {
  mealSchema,
  favouriteFromMeal,
  repeatMeal,
  dietTargetsSchema,
  totalNutrients,
  nutritionSummary,
  findMeals,
  mealTypes,
  foodGroups,
  type Meal,
} from "@/lib/nutrition";
import { MealDetails } from "../meal-details";
import {
  DietTargetsForm,
  MealForm,
  blankFoodItem,
  nutrientKeys,
} from "../food-forms";

const macroLabel = { protein: "Protein", carbs: "Carbs", fat: "Fat" };

// Progress toward a daily target; nothing is drawn without one.
function TargetBar({
  nutrient,
  value,
  target,
}: {
  nutrient: string;
  value: number;
  target: number | null;
}) {
  if (target == null || target <= 0) return null;
  return (
    <progress
      aria-label={`${nutrient} toward target`}
      value={Math.min(value, target)}
      max={target}
    />
  );
}
import { ImageLibrary } from "../image-library";
import { FoodPhotoImage } from "../food-photo";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
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
  const [removeMealId, setRemoveMealId] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>, message?: string) => {
    setError("");
    setNotice("");
    try {
      await work();
      if (message !== undefined) setNotice(message);
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
  const hasFood = meals.length > 0;
  const totals = totalNutrients(meals.flatMap((m) => m.items));
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const week = nutritionSummary(
    nutrition,
    Number.isNaN(start.getTime()) ? date : start.toISOString().slice(0, 10),
    date,
  );
  const target = (key: (typeof nutrientKeys)[number]) =>
    nutrition.targets[key] ?? null;
  const remaining = (key: (typeof nutrientKeys)[number]) => {
    const goal = target(key)!;
    const unit = key === "calories" ? "kcal" : "g";
    const diff = Math.abs(Math.round(goal - totals[key]));
    return `${diff.toLocaleString("en-GB")} ${unit} ${totals[key] > goal ? "above target" : "remaining"}`;
  };
  const weekMax = Math.max(1, ...week.days.map((day) => day.calories));
  return (
    <div className="food-page">
      <div className="page-heading compact">
        <div>
          <h1>Food</h1>
          <p className="lead">
            Log a meal, photograph your plate, or repeat a usual meal.
          </p>
        </div>
        <div className="button-row">
          <Button onClick={() => go("coach/capture")}>
            <MessageCircle size={17} /> Log food
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              setEditor({
                id: uid(),
                name: "",
                date,
                type: "lunch",
                items: [blankFoodItem()],
                source: "manual",
                estimated: false,
                notes: "",
                photoIds: [],
                createdAt: new Date().toISOString(),
              })
            }
          >
            <Plus size={17} /> Add meal
          </Button>
        </div>
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
      </div>
      {hasFood && (
        <section className="food-totals" aria-label={`Food totals for ${date}`}>
          <div className="food-calories">
            <span className="area-tile-heading">
              <AreaIcon area="food" icon={Flame} size="sm" />
              <span>Calories</span>
            </span>
            <p>
              <strong>{totals.calories.toLocaleString("en-GB")}</strong>
              <span>
                {target("calories") == null
                  ? "kcal · no daily target"
                  : `of ${target("calories")!.toLocaleString("en-GB")} kcal`}
              </span>
            </p>
            <TargetBar
              nutrient="calories"
              value={totals.calories}
              target={target("calories")}
            />
            {target("calories") != null && (
              <span className="fine-print">{remaining("calories")}</span>
            )}
          </div>
          <div className="food-macros">
            {(["protein", "carbs", "fat"] as const).map((key) => (
              <div key={key} data-macro={key}>
                <span>{macroLabel[key]}</span>
                <strong>
                  {totals[key]} <small>g</small>
                </strong>
                <TargetBar
                  nutrient={key}
                  value={totals[key]}
                  target={target(key)}
                />
                <small>
                  {target(key) == null ? "No daily target" : remaining(key)}
                </small>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="fine-print">
        {hasFood
          ? `${meals.length} meals logged. Totals reflect recorded food only.`
          : "No meals logged for this date. This does not mean you ate nothing."}{" "}
        Diet goal: {nutrition.targets.goal} weight. Photo estimates depend on
        portions, ingredients and cooking fats.
      </p>
      {(hasFood || nutrition.completeDays?.includes(date)) && (
        <section
          className="food-completeness"
          data-complete={nutrition.completeDays?.includes(date) || undefined}
        >
          <div>
            <strong>
              {nutrition.completeDays?.includes(date)
                ? "Food log marked complete"
                : "Is everything logged for this day?"}
            </strong>
            <p className="fine-print">
              Only days you mark complete enter weekly intake averages. Editing
              food reopens the day. Portions can still be estimates.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={date > today() || Boolean(journal.record?.conflict)}
            onClick={() =>
              void run(async () => {
                const complete = nutrition.completeDays?.includes(date);
                await journal.update((s) => {
                  s.nutrition.completeDays = complete
                    ? (s.nutrition.completeDays ?? []).filter((d) => d !== date)
                    : [...(s.nutrition.completeDays ?? []), date];
                });
                setNotice(
                  complete
                    ? "Day marked partial."
                    : "Food day marked complete.",
                );
              })
            }
          >
            {nutrition.completeDays?.includes(date)
              ? "Mark as partial"
              : "Mark day complete"}
          </Button>
        </section>
      )}
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
            {accountId && meal.photoIds.length > 0 && (
              <div className="food-photo-strip">
                {meal.photoIds.map((id) => (
                  <FoodPhotoImage
                    key={`${accountId}:${id}`}
                    id={id}
                    accountId={accountId}
                    label={meal.name}
                    description={`${meal.type} · ${meal.date}`}
                  />
                ))}
              </div>
            )}
            <div className="food-meal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditor(structuredClone(meal))}
              >
                Edit meal
              </Button>
              <Button
                variant="ghost"
                disabled={(nutrition.favourites?.length ?? 0) >= 50}
                onClick={() =>
                  void run(async () => {
                    const favourite = favouriteFromMeal(meal);
                    await journal.update((s) => {
                      s.nutrition.favourites = [
                        ...(s.nutrition.favourites ?? []),
                        favourite,
                      ];
                    });
                    setNotice(`${meal.name} saved to Favourite meals.`);
                  })
                }
              >
                Save as favourite
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="food-meal-delete"
                onClick={() => setRemoveMealId(meal.id)}
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
      <details className="food-favourites">
        <summary>Favourite meals · {nutrition.favourites?.length ?? 0}</summary>
        <p className="fine-print">
          Save a logged meal as a favourite, then reuse its portions and
          ingredient tags. Review before logging; old photos are not copied.
        </p>
        {(nutrition.favourites ?? []).map((meal) => (
          <article className="food-favourite" key={meal.id}>
            <div>
              <strong>{meal.name}</strong>
              <small>
                {meal.type} · {totalNutrients(meal.items).calories} kcal
                {meal.estimated ? " · estimated" : ""}
              </small>
            </div>
            <div className="button-row">
              <Button
                variant="secondary"
                onClick={() => setEditor(repeatMeal(meal, date))}
              >
                Review & log
              </Button>
              <Button
                variant="ghost"
                aria-label={`Remove favourite ${meal.name}`}
                onClick={() =>
                  void run(async () => {
                    await journal.update((s) => {
                      s.nutrition.favourites = (
                        s.nutrition.favourites ?? []
                      ).filter((m) => m.id !== meal.id);
                    });
                    setNotice("Favourite removed. Logged meals are kept.");
                  })
                }
              >
                Remove
              </Button>
            </div>
          </article>
        ))}
        {!nutrition.favourites?.length && (
          <p className="muted">Your go-to meals will appear here.</p>
        )}
      </details>
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
            <button
              key={day.date}
              aria-pressed={day.date === date}
              onClick={() => setDate(day.date)}
            >
              <span className="food-week-bar" aria-hidden="true">
                <span
                  style={{
                    height: `${Math.round((day.calories / weekMax) * 100)}%`,
                  }}
                />
              </span>
              <strong>{day.calories} kcal</strong>
              <small>{day.protein} g protein</small>
              <span>{day.date.slice(5)}</span>
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
          <MealForm
            meal={editor}
            error={error}
            onChange={setEditor}
            onSubmit={() =>
              void run(async () => {
                const meal = mealSchema.parse(editor);
                if (meal.date > today())
                  throw Error("Choose today or a past meal date.");
                await journal.update((s) => {
                  const previousDate = s.nutrition.meals.find(
                    (m) => m.id === meal.id,
                  )?.date;
                  if (s.nutrition.completeDays)
                    s.nutrition.completeDays = s.nutrition.completeDays.filter(
                      (d) => d !== meal.date && d !== previousDate,
                    );
                  s.nutrition.meals = [
                    ...s.nutrition.meals.filter((m) => m.id !== meal.id),
                    meal,
                  ];
                });
                setEditor(null);
              }, "Meal saved to your journal.")
            }
          />
        )}
      </Dialog>
      <Dialog
        open={showTargets}
        onOpenChange={setShowTargets}
        title="Your daily targets"
        description="Choose targets that fit your own plan. Leave a field blank to track without a target."
      >
        <DietTargetsForm
          targets={targets}
          onChange={setTargets}
          onSubmit={() =>
            void run(async () => {
              const value = dietTargetsSchema.parse(targets);
              await journal.update((s) => {
                s.nutrition.targets = value;
              });
              setShowTargets(false);
            }, "Daily targets saved.")
          }
        />
      </Dialog>
      <Dialog
        open={Boolean(removeMealId)}
        onOpenChange={(open) => {
          if (!open) setRemoveMealId(null);
        }}
        title="Delete meal?"
        description="Removes this meal from your daily totals. Its photos stay in your library."
      >
        <Button
          type="button"
          variant="danger"
          onClick={() =>
            void run(async () => {
              if (!removeMealId) return;
              await journal.update((s) => {
                const date = s.nutrition.meals.find(
                  (m) => m.id === removeMealId,
                )?.date;
                if (s.nutrition.completeDays)
                  s.nutrition.completeDays = s.nutrition.completeDays.filter(
                    (d) => d !== date,
                  );
                s.nutrition.meals = s.nutrition.meals.filter(
                  (m) => m.id !== removeMealId,
                );
              });
              setRemoveMealId(null);
            }, "Entry deleted.")
          }
        >
          Delete meal
        </Button>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    </div>
  );
}
