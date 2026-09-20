import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodePolyline,
  estimateDuration,
  kmBetween,
  offsetPoint,
  planRoute,
  simplifyPath,
} from "../lib/route-plan";
import { visualSchema, visualToolSchema } from "../lib/coach-visuals";

const copenhagen = { lat: 55.6761, lng: 12.5683, name: "Copenhagen, Denmark" };
const faelled = { lat: 55.7036, lng: 12.5681, name: "Fælledparken, Copenhagen" };
const lakes = { lat: 55.6847, lng: 12.571, name: "Sortedams Sø, Copenhagen" };

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function polylineFor() {
  return "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
}

function geocodePayload(href: string) {
  const query = decodeURIComponent(href);
  const hit = /east/i.test(query)
    ? { lat: 55.705, lng: 12.58, name: "Fælledparken east, Copenhagen" }
    : /fælled|faelled|park/i.test(query)
      ? faelled
      : /sø|soe|lake|sortedams/i.test(query)
        ? lakes
        : copenhagen;
  return {
    status: "OK",
    results: [
      {
        formatted_address: hit.name,
        types: /park|sø|lake/i.test(query) ? ["park"] : ["locality"],
        geometry: { location: { lat: hit.lat, lng: hit.lng } },
      },
    ],
  };
}

test("simplifyPath keeps ends and bounds the number of points", () => {
  const points = Array.from(
    { length: 500 },
    (_, i) => [55 + i / 1000, 12 + i / 1000] as [number, number],
  );
  const path = simplifyPath(points, 20);
  assert.equal(path.length, 20);
  assert.deepEqual(path[0], points[0]);
  assert.deepEqual(path.at(-1), points.at(-1));
});

test("decodePolyline restores Google's sample coordinates", () => {
  const path = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.equal(path.length, 3);
  assert.ok(Math.abs(path[0]![0] - 38.5) < 0.001);
  assert.ok(Math.abs(path[0]![1] + 120.2) < 0.001);
});

test("offsetPoint moves a point roughly the requested distance", () => {
  const moved = offsetPoint(55.68, 12.57, 1, 90);
  assert.ok(Math.abs(moved.lat - 55.68) < 0.01);
  assert.ok(moved.lng > 12.57);
  assert.ok(Math.abs(kmBetween({ lat: 55.68, lng: 12.57 }, moved) - 1) < 0.02);
});

test("running duration uses a 10 km/h estimate rather than walking-speed Google times", () => {
  assert.equal(estimateDuration("run", 10, 7200), 3600);
  assert.equal(estimateDuration("walk", 10, 7200), 7200);
  assert.equal(estimateDuration("bike", 10, 1800), 1800);
});

test("planRoute geocodes with Google and draws an A-to-B walking route", async () => {
  const planned = await planRoute(
    {
      start: "Copenhagen",
      end: "Sortedams Sø",
      activity: "run",
      title: "Lakes run",
    },
    {
      key: "test-key",
      fetch: async (url) => {
        const href = String(url);
        assert.match(href, /maps.googleapis.com/);
        assert.match(href, /key=test-key/);
        if (href.includes("/geocode/"))
          return jsonResponse(geocodePayload(href));
        if (href.includes("/place/nearbysearch/"))
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        assert.match(href, /\/directions\/.*mode=walking/);
        return jsonResponse({
          status: "OK",
          routes: [
            {
              overview_polyline: { points: polylineFor() },
              legs: [
                {
                  distance: { value: 4200 },
                  duration: { value: 2100 },
                },
              ],
            },
          ],
        });
      },
    },
  );
  assert.equal(planned.title, "Lakes run");
  assert.equal(planned.distanceKm, 4.2);
  assert.equal(planned.loop, false);
  assert.ok(planned.path.length >= 2);
  const parsed = visualSchema.safeParse({ kind: "route_map", ...planned });
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : JSON.stringify(parsed.error.issues),
  );
  assert.equal(
    visualToolSchema.safeParse({ kind: "route_map", title: "Lakes run" })
      .success,
    false,
  );
});

test("a requested 5 km park loop uses parks and lands near 5 km instead of a short A-to-B", async () => {
  const distances: number[] = [];
  const planned = await planRoute(
    {
      start: "Fælledparken",
      activity: "run",
      targetKm: 5,
      preferParks: true,
    },
    {
      key: "test-key",
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/geocode/"))
          return jsonResponse(geocodePayload("Fælledparken"));
        if (href.includes("/place/nearbysearch/"))
          return jsonResponse({
            status: "OK",
            results: [
              {
                name: "Fælledparken north",
                types: ["park"],
                geometry: { location: { lat: 55.71, lng: 12.57 } },
              },
              {
                name: "Fælledparken east",
                types: ["park"],
                geometry: { location: { lat: 55.705, lng: 12.58 } },
              },
            ],
          });
        assert.match(href, /via%3A|via:/);
        const decoded = decodeURIComponent(href);
        const vias = (decoded.match(/via:/g) ?? []).length;
        const metres = vias >= 2 ? 5120 : 3480;
        distances.push(metres);
        return jsonResponse({
          status: "OK",
          routes: [
            {
              overview_polyline: { points: polylineFor() },
              legs: [
                { distance: { value: metres }, duration: { value: 1800 } },
              ],
            },
          ],
        });
      },
    },
  );
  assert.equal(planned.loop, true);
  assert.equal(planned.targetKm, 5);
  assert.ok(planned.distanceKm >= 4.6);
  assert.match(planned.caption, /5\.0 km/);
  assert.ok(planned.stops.some((stop) => /Fælledparken/i.test(stop.label)));
});

test("clustered parks near the start still scale a loop out to 5 km", async () => {
  const planned = await planRoute(
    {
      start: "Fælledparken",
      activity: "run",
      targetKm: 5,
      preferParks: true,
    },
    {
      key: "test-key",
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/geocode/"))
          return jsonResponse(geocodePayload("Fælledparken"));
        if (href.includes("/place/nearbysearch/"))
          return jsonResponse({
            status: "OK",
            results: [
              {
                name: "Fælledparken lawn",
                types: ["park"],
                geometry: { location: { lat: 55.704, lng: 12.5683 } },
              },
              {
                name: "Fælledparken path",
                types: ["park"],
                geometry: { location: { lat: 55.7038, lng: 12.5685 } },
              },
            ],
          });
        const decoded = decodeURIComponent(href);
        const offsets = [...decoded.matchAll(/via:([\d.-]+),([\d.-]+)/g)].map(
          (match) =>
            Math.abs(Number(match[1]) - faelled.lat) +
            Math.abs(Number(match[2]) - faelled.lng),
        );
        const metres = Math.max(...offsets, 0) > 0.008 ? 5080 : 3400;
        return jsonResponse({
          status: "OK",
          routes: [
            {
              overview_polyline: { points: polylineFor() },
              legs: [
                { distance: { value: metres }, duration: { value: 1800 } },
              ],
            },
          ],
        });
      },
    },
  );
  assert.equal(planned.loop, true);
  assert.ok(planned.distanceKm >= 4.6);
});

test("a short park-to-park request with a 5 km target becomes a loop", async () => {
  const planned = await planRoute(
    {
      start: "Fælledparken",
      end: "Fælledparken east",
      activity: "run",
      targetKm: 5,
      preferParks: true,
    },
    {
      key: "test-key",
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/geocode/"))
          return jsonResponse(geocodePayload(href));
        if (href.includes("/place/nearbysearch/"))
          return jsonResponse({
            status: "OK",
            results: [
              {
                name: "Fælledparken north",
                types: ["park"],
                geometry: { location: { lat: 55.71, lng: 12.57 } },
              },
            ],
          });
        const metres = decodeURIComponent(href).includes("via:") ? 5010 : 1200;
        return jsonResponse({
          status: "OK",
          routes: [
            {
              overview_polyline: { points: polylineFor() },
              legs: [
                { distance: { value: metres }, duration: { value: 1800 } },
              ],
            },
          ],
        });
      },
    },
  );
  assert.equal(planned.loop, true);
  assert.equal(planned.distanceKm, 5.01);
});

test("a too-short A-to-B is lengthened toward the requested distance", async () => {
  let calls = 0;
  const planned = await planRoute(
    {
      start: "Copenhagen",
      end: "Sortedams Sø",
      activity: "run",
      targetKm: 5,
    },
    {
      key: "test-key",
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/geocode/"))
          return jsonResponse(geocodePayload(href));
        if (href.includes("/place/nearbysearch/"))
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        calls += 1;
        const metres = decodeURIComponent(href).includes("via:") ? 5050 : 3500;
        return jsonResponse({
          status: "OK",
          routes: [
            {
              overview_polyline: { points: polylineFor() },
              legs: [
                { distance: { value: metres }, duration: { value: 1600 } },
              ],
            },
          ],
        });
      },
    },
  );
  assert.ok(calls >= 2);
  assert.equal(planned.distanceKm, 5.05);
});

test("planRoute fails closed without a key or an unknown place", async () => {
  await assert.rejects(
    () =>
      planRoute(
        { start: "Copenhagen", end: "Lyngby", activity: "walk" },
        { key: "", fetch: async () => jsonResponse({}) },
      ),
    /Google Maps is not connected/,
  );
  await assert.rejects(
    () =>
      planRoute(
        { start: "Nowhere-xyz", end: "Copenhagen", activity: "walk" },
        {
          key: "test-key",
          fetch: async () =>
            jsonResponse({ status: "ZERO_RESULTS", results: [] }),
        },
      ),
    /Could not find/,
  );
});

// The three complaints about Coach routes: a named heading was ignored, a
// refinement returned the previous route, and parks were found then dropped.
function bearingFromStart(lat: number, lng: number) {
  const from = (faelled.lat * Math.PI) / 180;
  const to = (lat * Math.PI) / 180;
  const dLng = ((lng - faelled.lng) * Math.PI) / 180;
  const degrees =
    (Math.atan2(
      Math.sin(dLng) * Math.cos(to),
      Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(dLng),
    ) *
      180) /
    Math.PI;
  return (degrees + 360) % 360;
}

function loopProbe(parks: { lat: number; lng: number; name: string }[] = []) {
  const waypoints: { lat: number; lng: number }[][] = [];
  const fetchImpl = async (url: RequestInfo | URL) => {
    const href = decodeURIComponent(String(url));
    if (href.includes("/geocode/")) return jsonResponse(geocodePayload("Fælledparken"));
    if (href.includes("/place/nearbysearch/"))
      return jsonResponse({
        status: "OK",
        results: parks.map((park) => ({
          name: park.name,
          types: ["park"],
          geometry: { location: { lat: park.lat, lng: park.lng } },
        })),
      });
    waypoints.push(
      [...href.matchAll(/via:([\d.-]+),([\d.-]+)/g)].map((match) => ({
        lat: Number(match[1]),
        lng: Number(match[2]),
      })),
    );
    return jsonResponse({
      status: "OK",
      routes: [
        {
          overview_polyline: { points: polylineFor() },
          legs: [{ distance: { value: 10050 }, duration: { value: 2400 } }],
        },
      ],
    });
  };
  return {
    waypoints,
    deps: { key: "test-key", fetch: fetchImpl as unknown as typeof fetch },
  };
}

test("a ride in a named direction heads that way instead of ringing the start", async () => {
  const probe = loopProbe();
  const planned = await planRoute(
    { start: "Fælledparken", activity: "bike", targetKm: 10, direction: "north" },
    probe.deps,
  );
  const sent = probe.waypoints.at(-1)!;
  assert.ok(sent.length >= 2);
  // Every waypoint sits in the northern half rather than surrounding the start.
  for (const point of sent) {
    const bearing = bearingFromStart(point.lat, point.lng);
    assert.ok(
      bearing <= 90 || bearing >= 270,
      `waypoint at bearing ${bearing.toFixed(0)} is not toward the north`,
    );
    assert.ok(point.lat > faelled.lat, "waypoint should be north of the start");
  }
  assert.match(planned.title, /north from/);
  assert.match(planned.caption, /Heads north/);
});

test("an undirected loop still encircles the start", async () => {
  const probe = loopProbe();
  await planRoute(
    { start: "Fælledparken", activity: "bike", targetKm: 10 },
    probe.deps,
  );
  const sent = probe.waypoints.at(-1)!;
  assert.equal(sent.length, 4);
  assert.ok(sent.some((point) => point.lat > faelled.lat));
  assert.ok(sent.some((point) => point.lat < faelled.lat));
});

test("asking again with a new variant returns a different route", async () => {
  const first = loopProbe();
  await planRoute(
    { start: "Fælledparken", activity: "run", targetKm: 10, parkBias: "some" },
    first.deps,
  );
  const repeat = loopProbe();
  await planRoute(
    { start: "Fælledparken", activity: "run", targetKm: 10, parkBias: "some" },
    repeat.deps,
  );
  const varied = loopProbe();
  await planRoute(
    {
      start: "Fælledparken",
      activity: "run",
      targetKm: 10,
      parkBias: "some",
      variant: 1,
    },
    varied.deps,
  );
  const shape = (points: { lat: number; lng: number }[]) =>
    JSON.stringify(points.map((p) => [p.lat.toFixed(4), p.lng.toFixed(4)]));
  assert.equal(
    shape(repeat.waypoints.at(-1)!),
    shape(first.waypoints.at(-1)!),
    "the same request should stay stable",
  );
  assert.notEqual(
    shape(varied.waypoints.at(-1)!),
    shape(first.waypoints.at(-1)!),
    "a new variant must not repeat the previous route",
  );
});

test("a high park bias routes through parks the old snap window discarded", async () => {
  const parks = [
    { lat: 55.7128, lng: 12.5681, name: "Nørrebroparken" },
    { lat: 55.6944, lng: 12.5881, name: "Østre Anlæg" },
  ];
  const biased = loopProbe(parks);
  await planRoute(
    { start: "Fælledparken", activity: "run", targetKm: 5, parkBias: "high" },
    biased.deps,
  );
  const used = biased.waypoints.at(-1)!;
  const hits = parks.filter((park) =>
    used.some(
      (point) =>
        Math.abs(point.lat - park.lat) < 1e-6 &&
        Math.abs(point.lng - park.lng) < 1e-6,
    ),
  );
  assert.ok(
    hits.length >= 1,
    "a high park bias should route through a nearby park",
  );
});
