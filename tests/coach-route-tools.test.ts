import { test } from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions } from "../lib/agent/engine";
import { systemPrompt } from "../lib/agent/knowledge";
import {
  planRoute,
  routeDirectionSchema,
  routeParkBiasSchema,
  routeRequestSchema,
} from "../lib/route-plan";
import { visualSchema } from "../lib/coach-visuals";

// Coach can only ask for a heading, a greener route or a different route if
// the tool it is handed actually carries those fields and explains them. These
// checks run against the real definition sent to the model, not a copy.
type JsonSchema = {
  properties: Record<
    string,
    { type?: string; enum?: string[]; minimum?: number; maximum?: number }
  >;
  required: string[];
  additionalProperties: boolean;
};

const planRouteTool = () => {
  const found = toolDefinitions.find(
    (definition) => definition.function.name === "plan_route",
  );
  assert.ok(found, "plan_route must be offered to Coach");
  return {
    description: found.function.description,
    schema: found.function.parameters as unknown as JsonSchema,
  };
};

test("the plan_route tool offers a heading, a park bias and a variant", () => {
  const { schema } = planRouteTool();
  assert.deepEqual(
    schema.properties.direction?.enum,
    routeDirectionSchema.options,
  );
  assert.deepEqual(
    schema.properties.parkBias?.enum,
    routeParkBiasSchema.options,
  );
  assert.equal(schema.properties.variant?.type, "integer");
  assert.equal(schema.properties.variant?.minimum, 0);
  assert.equal(schema.properties.variant?.maximum, 5);
  // Unknown fields must still be refused, so a typo fails loudly.
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["start", "activity"]);
});

test("every heading and park bias Coach may send is explained in the tool text", () => {
  const { description } = planRouteTool();
  for (const heading of routeDirectionSchema.options)
    assert.ok(
      description.includes(heading),
      `the tool text never mentions ${heading}, so Coach cannot pick it`,
    );
  for (const bias of ["some", "high"])
    assert.ok(
      description.includes(`parkBias: "${bias}"`),
      `the tool text never shows parkBias ${bias}`,
    );
  assert.match(description, /variant/);
  // "none" stays accepted as an explicit off switch without being advertised.
  assert.equal(routeParkBiasSchema.safeParse("none").success, true);
});

test("the Coach prompt teaches the fields the route planner now needs", () => {
  const prompt = systemPrompt("2026-09-07", "Europe/Copenhagen");
  assert.match(prompt, /parkBias/);
  assert.match(prompt, /Pass direction when they name a heading/);
  assert.match(prompt, /variant 1, 2 or 3/);
  assert.match(prompt, /repeating a request unchanged returns the same route/);
});

test("the payloads the prompt tells Coach to send all satisfy the tool schema", () => {
  const documented = [
    { start: "Fælledparken", activity: "run", targetKm: 5, parkBias: "some" },
    { start: "Copenhagen", activity: "bike", targetKm: 30, direction: "north" },
    {
      start: "Copenhagen",
      activity: "run",
      targetKm: 10,
      parkBias: "high",
      variant: 3,
    },
    // The older boolean form still appears in saved conversations.
    { start: "Fælledparken", activity: "run", targetKm: 5, preferParks: true },
  ];
  for (const payload of documented) {
    const parsed = routeRequestSchema.safeParse(payload);
    assert.equal(
      parsed.success,
      true,
      `prompt teaches ${JSON.stringify(payload)} but the tool rejects it`,
    );
  }
  for (const bad of [
    { start: "Copenhagen", activity: "bike", targetKm: 30, direction: "up" },
    { start: "Copenhagen", activity: "bike", targetKm: 30, parkBias: "lots" },
    { start: "Copenhagen", activity: "bike", targetKm: 30, variant: 9 },
    { start: "Copenhagen", activity: "bike", targetKm: 30, heading: "north" },
  ])
    assert.equal(
      routeRequestSchema.safeParse(bad).success,
      false,
      `${JSON.stringify(bad)} should be refused`,
    );
});

const start = { lat: 55.6761, lng: 12.5683 };
function mapsStub(waypoints: { lat: number; lng: number }[][]) {
  const reply = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  return (async (url: RequestInfo | URL) => {
    const href = decodeURIComponent(String(url));
    if (href.includes("/geocode/"))
      return reply({
        status: "OK",
        results: [
          {
            formatted_address: "Copenhagen, Denmark",
            types: ["locality"],
            geometry: { location: start },
          },
        ],
      });
    if (href.includes("/place/nearbysearch/"))
      return reply({
        status: "OK",
        results: [
          {
            name: "Nørrebroparken",
            types: ["park"],
            geometry: { location: { lat: 55.6905, lng: 12.546 } },
          },
        ],
      });
    waypoints.push(
      [...href.matchAll(/via:([\d.-]+),([\d.-]+)/g)].map((match) => ({
        lat: Number(match[1]),
        lng: Number(match[2]),
      })),
    );
    return reply({
      status: "OK",
      routes: [
        {
          overview_polyline: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
          legs: [{ distance: { value: 30100 }, duration: { value: 5400 } }],
        },
      ],
    });
  }) as unknown as typeof fetch;
}

// Coach's arguments go through the tool schema, the planner and finally the
// visual contract the map component renders. A break anywhere shows up here.
async function coachAsksFor(args: unknown) {
  const waypoints: { lat: number; lng: number }[][] = [];
  const planned = await planRoute(routeRequestSchema.parse(args), {
    key: "test-key",
    fetch: mapsStub(waypoints),
  });
  const visual = visualSchema.safeParse({ kind: "route_map", ...planned });
  assert.equal(
    visual.success,
    true,
    visual.success ? "" : JSON.stringify(visual.error.issues),
  );
  return { planned, waypoints: waypoints.at(-1)! };
}

test("a ride asked for up north reaches the map as a route that heads north", async () => {
  const { planned, waypoints } = await coachAsksFor({
    start: "Copenhagen",
    activity: "bike",
    targetKm: 30,
    direction: "north",
  });
  assert.ok(waypoints.length >= 2);
  assert.ok(
    waypoints.every((point) => point.lat > start.lat),
    "a northern ride must not place waypoints south of the start",
  );
  assert.match(planned.title, /north from/);
  assert.match(planned.caption, /Heads north/);
  assert.equal(planned.loop, true);
});

const shapeOf = (points: { lat: number; lng: number }[]) =>
  JSON.stringify(points.map((p) => [p.lat.toFixed(4), p.lng.toFixed(4)]));

test("the variant alone changes the route, with every other field held equal", async () => {
  // Varying only this field isolates it. Changing the park bias at the same
  // time would hide a variant that had stopped having any effect.
  const base = {
    start: "Copenhagen",
    activity: "run",
    targetKm: 30,
    parkBias: "some",
  };
  const first = await coachAsksFor(base);
  const same = await coachAsksFor({ ...base });
  const next = await coachAsksFor({ ...base, variant: 1 });
  const later = await coachAsksFor({ ...base, variant: 2 });
  assert.equal(
    shapeOf(same.waypoints),
    shapeOf(first.waypoints),
    "an unchanged request should stay stable",
  );
  for (const [label, run] of [
    ["variant 1", next],
    ["variant 2", later],
  ] as const)
    assert.notEqual(
      shapeOf(run.waypoints),
      shapeOf(first.waypoints),
      `${label} must not return the first route`,
    );
  assert.notEqual(
    shapeOf(later.waypoints),
    shapeOf(next.waypoints),
    "each variant must differ from the other",
  );
});

test("a greener request is pulled onto parks and says so on the map", async () => {
  const some = await coachAsksFor({
    start: "Copenhagen",
    activity: "run",
    targetKm: 30,
    parkBias: "some",
  });
  const high = await coachAsksFor({
    start: "Copenhagen",
    activity: "run",
    targetKm: 30,
    parkBias: "high",
  });
  assert.notEqual(
    shapeOf(high.waypoints),
    shapeOf(some.waypoints),
    "a stronger park bias must change which points the route runs through",
  );
  assert.match(high.planned.caption, /Pulled onto parks/);
  assert.match(some.planned.caption, /Prefers parks/);
});
