import { cardioTitle, type CardioEntry } from "./cardio";
import type { CoachVisual } from "./coach-visuals";
import { kmBetween } from "./route-plan";

// Pure helpers for GPS routes recorded by Apple Health: their length and
// shape, a short description for the coaches, and a map visual.
export type Point = [number, number];
const point = ([lat, lng]: Point) => ({ lat, lng });

export function pathKm(path: Point[]) {
  let km = 0;
  for (let i = 1; i < path.length; i++)
    km += kmBetween(point(path[i - 1]!), point(path[i]!));
  return Math.round(km * 1000) / 1000;
}

// A route that ends within 300 m of where it started went out and back.
export const isLoop = (path: Point[]) =>
  path.length > 2 &&
  kmBetween(point(path[0]!), point(path[path.length - 1]!)) < 0.3;

export type RouteNote = {
  start?: string;
  end?: string;
  farthest_point?: string;
  loop: boolean;
  route_km: number;
};

export type RecordedRoute = {
  path: Point[];
  distanceKm: number;
  startPlace: string | null;
  endPlace: string | null;
  farthestPlace: string | null;
  loop: boolean;
};

// The point farthest from the start: where an out-and-back turned round.
// The phone names the same point, so the name and the marker agree.
export function farthestPoint(path: Point[]) {
  let best = path[0]!,
    distance = 0;
  for (const p of path) {
    const d = kmBetween(point(path[0]!), point(p));
    if (d > distance) [best, distance] = [p, d];
  }
  return best;
}

const mapActivity = (activity: CardioEntry["activity"]) =>
  activity === "running"
    ? "run"
    : activity === "cycling"
      ? "bike"
      : activity === "walking" || activity === "hiking"
        ? "walk"
        : "other";

// A recorded route as a map visual for Coach, in the same form as a planned
// route so the website and the app draw it the same way.
export function recordedRouteVisual(
  entry: CardioEntry,
  route: RecordedRoute,
): Extract<CoachVisual, { kind: "route_map" }> {
  const [first, last] = [route.path[0]!, route.path[route.path.length - 1]!];
  const stop = ([lat, lng]: Point, label: string) => ({
    lat,
    lng,
    label: label.slice(0, 120),
  });
  const stops = route.loop
    ? [
        stop(first, route.startPlace ?? "Start"),
        stop(farthestPoint(route.path), route.farthestPlace ?? "Turnaround"),
        stop(last, route.endPlace ?? route.startPlace ?? "Finish"),
      ]
    : [
        stop(first, route.startPlace ?? "Start"),
        stop(last, route.endPlace ?? "Finish"),
      ];
  const where = describeRoute({
    start: route.startPlace ?? undefined,
    end: route.endPlace ?? undefined,
    farthest_point: route.farthestPlace ?? undefined,
    loop: route.loop,
    route_km: route.distanceKm,
  });
  return {
    kind: "route_map",
    title:
      `${cardioTitle(entry)} · ${new Date(`${entry.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`.slice(
        0,
        120,
      ),
    caption: `Recorded by Apple Health${where ? `, ${where}` : ""}.`.slice(
      0,
      400,
    ),
    activity: mapActivity(entry.activity),
    distanceKm:
      Math.round(
        (entry.distanceKm && entry.distanceKm > 0
          ? entry.distanceKm
          : Math.max(route.distanceKm, 0.01)) * 100,
      ) / 100,
    durationSeconds: entry.durationSeconds,
    loop: route.loop,
    recorded: true,
    stops,
    path: route.path,
  };
}

// One short phrase for a route, such as "from Vesterbro out to Frederiksberg
// Have and back" or "from Nørreport to Amager Strand".
export function describeRoute(note: RouteNote) {
  if (note.loop)
    return [
      note.start ? `from ${note.start}` : "",
      note.farthest_point && note.farthest_point !== note.start
        ? `out to ${note.farthest_point} and back`
        : "and back",
    ]
      .filter(Boolean)
      .join(" ");
  return [
    note.start ? `from ${note.start}` : "",
    note.end ? `to ${note.end}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
