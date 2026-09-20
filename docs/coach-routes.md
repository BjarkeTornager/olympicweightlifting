# Coach route planning

Ask Coach for a running, walking or cycling route and it answers with a Google Map. The map is a suggestion with direction arrows. It is not GPS navigation, traffic advice or a logged cardio entry; logging a completed run or ride still goes through `record_cardio`.

## What the planner accepts

`plan_route` takes a named `start`, an optional `end`, up to three `via` places, an `activity` of run/walk/bike and a `targetKm`. Either an end or a target distance is required. Three fields shape the result:

- **`direction`** is one of the eight compass headings. Without it a loop is four fixed bearings around the start, which reads as a ring around the whole city. With it the planner builds an out-and-back lobe along that heading, so "a ride up north" travels north. The heading also chooses which way a too-short A-to-B route bulges.
- **`parkBias`** is `none`, `some` or `high`. A found park is used when it sits within a distance of the shape's next corner, and `high` widens that window enough to pull the route through parks that `some` would leave behind. The older boolean `preferParks` still maps onto `some` so saved conversations replay unchanged.
- **`variant`** is 0 to 5. The planner is otherwise deterministic, so an unchanged request returns the same route. A new variant shifts the bearings and the order parks are paired with corners, which is how "give me a different one" produces a different route.

Coach is told about all three in the `plan_route` tool description and in the route paragraph of its system prompt.

## Verification

Four layers cover this, cheapest first.

`tests/route-plan.test.ts` covers the planner itself against a stubbed Google Maps: geometry helpers, distance convergence, an undirected loop still encircling the start, a directed loop keeping every waypoint on the requested side, a variant changing the route, and a high park bias routing through parks the old narrow window discarded.

`tests/coach-route-tools.test.ts` covers the contract between Coach and the planner. It asserts against the real tool definition sent to the model, so it fails if the schema and the prompt drift apart: every heading and park bias the schema accepts is explained in the tool text, the prompt still teaches the three fields, every payload the prompt tells Coach to send validates, malformed values are refused, and a planned route survives the visual schema the map component renders. The variant is varied on its own, with every other field held equal, so a variant that stopped having an effect cannot hide behind a simultaneous park-bias change.

Both files are mutation-checked. Removing the headings from the tool text, dropping the variant guidance from the prompt, making the planner ignore direction, narrowing the park window back, and removing the direction field each fail at least two tests.

`tests/browser/coach-route.spec.ts` renders a planned route as an interactive map in Chromium, WebKit and Firefox.

`scripts/route-smoke.ts` is an opt-in real-provider check requiring `ROUTE_SMOKE=true` and a disposable `_test` database. It is the only layer that measures whether Coach itself chooses `direction`, `parkBias` and `variant` from an ordinary sentence. Google Maps is stubbed inside the script, so it spends no Maps quota and does not depend on real geography, while the model provider is real. It asks for a ride heading north, checks the waypoints are north of the start, then says the route is the same as always and asks for a different and greener one, and checks the second route differs. It deletes its synthetic account in `finally` and must never run against production records.

```sh
ROUTE_SMOKE=true AGENT_PROVIDER=openrouter npx tsx scripts/route-smoke.ts
```

## Limits

The planner does not know the athlete's home address or any GPS position, and Coach is told not to guess one. Distances converge toward the target across at most five Maps routing attempts and can land a little off. A heading shapes the route but does not guarantee a specific neighbourhood, because the roads Google returns decide the final path.
