import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateDuration,
  planRoute,
  simplifyPath,
} from "../lib/route-plan";
import { visualSchema, visualToolSchema } from "../lib/coach-visuals";

const copenhagen = {
  lat: "55.676098",
  lon: "12.568337",
  display_name: "Copenhagen, Capital Region of Denmark, Denmark",
};
const lyngby = {
  lat: "55.770447",
  lon: "12.503628",
  display_name: "Kongens Lyngby, Lyngby-Taarbæk Municipality, Denmark",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

test("running duration uses a 10 km/h estimate rather than walking-speed OSRM times", () => {
  assert.equal(estimateDuration("run", 10, 7200), 3600);
  assert.equal(estimateDuration("walk", 10, 7200), 7200);
  assert.equal(estimateDuration("bike", 10, 1800), 1800);
});

test("planRoute geocodes named places, routes on OSM roads and never invents a path", async () => {
  const calls: string[] = [];
  const planned = await planRoute(
    {
      start: "Copenhagen",
      end: "Kongens Lyngby",
      activity: "run",
      title: "North run",
    },
    {
      wait: async () => {},
      fetch: async (url) => {
        const href = String(url);
        calls.push(href);
        if (href.startsWith("https://nominatim.openstreetmap.org/")) {
          assert.match(href, /q=Copenhagen|q=Kongens/);
          return jsonResponse(
            href.includes("Kongens") ? [lyngby] : [copenhagen],
          );
        }
        assert.match(
          href,
          /^https:\/\/router\.project-osrm\.org\/route\/v1\/foot\//,
        );
        return jsonResponse({
          code: "Ok",
          routes: [
            {
              distance: 12340,
              duration: 8900,
              geometry: {
                type: "LineString",
                coordinates: [
                  [12.568337, 55.676098],
                  [12.54, 55.72],
                  [12.503628, 55.770447],
                ],
              },
            },
          ],
        });
      },
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(planned.title, "North run");
  assert.equal(planned.activity, "run");
  assert.equal(planned.distanceKm, 12.34);
  assert.equal(planned.durationSeconds, 4442);
  assert.equal(planned.stops[0]?.label, "Copenhagen");
  assert.equal(planned.stops[1]?.label, "Kongens Lyngby");
  assert.equal(planned.path[0]?.[0], 55.676098);
  assert.equal(
    visualSchema.safeParse({ kind: "route_map", ...planned }).success,
    true,
  );
  assert.equal(
    visualToolSchema.safeParse({ kind: "route_map", title: "North run" })
      .success,
    false,
  );
});

test("planRoute uses the bike profile and fails closed when a place is unknown", async () => {
  const bike = await planRoute(
    { start: "Copenhagen", end: "Lyngby", activity: "bike" },
    {
      wait: async () => {},
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("nominatim")) return jsonResponse([copenhagen]);
        assert.match(href, /\/route\/v1\/bike\//);
        return jsonResponse({
          code: "Ok",
          routes: [
            {
              distance: 4000,
              duration: 900,
              geometry: {
                type: "LineString",
                coordinates: [
                  [12.56, 55.67],
                  [12.5, 55.77],
                ],
              },
            },
          ],
        });
      },
    },
  );
  assert.equal(bike.activity, "bike");
  await assert.rejects(
    () =>
      planRoute(
        { start: "Nowhere-xyz", end: "Copenhagen", activity: "walk" },
        {
          wait: async () => {},
          fetch: async (url) => {
            if (String(url).includes("nominatim")) return jsonResponse([]);
            throw Error("routing should not run");
          },
        },
      ),
    /Could not find/,
  );
});
