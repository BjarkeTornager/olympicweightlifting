# Food records and Coach queries

Food is stored inside each account’s private journal. A meal has a date and a meal type: `breakfast`, `lunch`, `dinner` or `snack`. Each food item keeps its own portion, calories and protein/carbs/fat, plus optional `classification`:

```json
{
  "foodGroups": ["meat", "grains"],
  "ingredients": [
    { "name": "chicken", "evidence": "reported" },
    { "name": "rice", "evidence": "visible" },
    { "name": "olive oil", "evidence": "estimated" }
  ]
}
```

Groups cover meat/poultry, seafood, eggs, dairy/alternatives, grains/potatoes, vegetables, fruit, beans/lentils, nuts/seeds, fats/oils, sweets, drinks and other. A mixed dish can have several groups. Ingredient names are reusable lowercase tags; comparisons normalize whitespace and case. Do not automatically merge different ingredients, brands or raw/cooked variants.

Evidence records why an ingredient was included: `reported` by the user, read from a `label`, `visible` in a photo, or `estimated` as an assumption. It is separate from whether nutrition is estimated. Estimated ingredients remain visibly marked in Coach review, web Food and native meal details. A tag is not a verified complete recipe or an allergy guarantee.

## Using the journal

In Food, use **Edit meal → Food groups & ingredients** to add tags or correct assumptions. Search food names or ingredient tags, select a meal type/group, and enable **Search all logged dates** for history. History loads 20 meals at a time; the selected date’s daily totals stay separate from filtered history.

In the iPhone app, add tags when logging Food. In **Journal → Food**, search ingredients or filter meal type/group; open a meal and choose **Edit food tags** to change its occasion, groups or ingredients without changing nutrition.

Coach can answer questions such as:

- What did I have for dinner yesterday?
- Which dinners included chicken last week?
- How often have I logged rice this month?
- Show my logged breakfast calories for the last seven days in a table.

Coach reads `food_journal` using explicit dates and optional `mealType`, `foodGroup`, `ingredient`, `evidence`, `query` and `offset`. Exact ingredient/group filters must match the same food item. Text queries cover meal names, item names and ingredients, including old records without tags. Results include full meals (20 per page), full matching-meal totals, separate matching-item totals, daily/meal-type breakdowns, distinct-meal ingredient frequency (up to 40 ingredients), and tagging coverage for the date range. Aggregates include all matches, not only the displayed page. A mixed food’s calories cannot be assigned to an individual ingredient from these data.

## Compatibility and privacy

This is an additive JSON data change, with no database migration or production data backfill. Existing records remain unchanged and unknown ingredients stay unknown. Coach offers reviewed corrections when asked to tag older meals. Images keep their independent Food/Sleep/Activity/Health categories; image tags never become saved ingredients automatically.

The current web and native clients identify food-tag support with `X-Food-Tags-Version: 1` on journal writes. Older requests preserve omitted classifications for uniquely matched item names/portions. Ambiguous matches are rejected for review. Explicit empty arrays clear tags. Server-owned Coach undo restores the exact previous snapshot, including missing metadata. Pre-release mutation hashes remain valid because optional classification has no schema default.

Export/import, account revision checks and private image ownership apply to tagged meals exactly as before. Query tools use only the signed-in account’s snapshot. No Apple Health connection, public meal endpoint, food database or automatic historical relabeling is introduced.
