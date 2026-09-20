import { z } from "zod";

export const routeActivitySchema = z.enum(["run", "walk", "bike"]);
export type RouteActivity = z.infer<typeof routeActivitySchema>;
export const routeRequestSchema = z
  .object({
    start: z.string().trim().min(2).max(200),
    end: z.string().trim().min(2).max(200),
    via: z.array(z.string().trim().min(2).max(200)).max(3).optional(),
    activity: routeActivitySchema,
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteStop = { lat: number; lng: number; label: string };
export type PlannedRoute = {
  title: string;
  activity: RouteActivity;
  distanceKm: number;
  durationSeconds: number;
  stops: RouteStop[];
  path: [number, number][];
  caption: string;
};

const USER_AGENT =
  "LiftJournal/2.0 (https://lift-journal-production.up.railway.app; cardio-route-planning)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1";
const MAX_PATH = 180;
const MAX_BYTES = 256000;

const nominatimHit = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string().min(1),
});
const osrmResponse = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z
            .array(z.tuple([z.number().finite(), z.number().finite()]))
            .min(2)
            .max(20000),
        }),
      }),
    )
    .min(1),
});

export function simplifyPath(
  points: [number, number][],
  max = MAX_PATH,
): [number, number][] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const path: [number, number][] = [];
  for (let i = 0; i < max - 1; i++)
    path.push(points[Math.round(i * step)]!);
  path.push(points[points.length - 1]!);
  return path;
}

export function estimateDuration(
  activity: RouteActivity,
  distanceKm: number,
  osrmSeconds: number,
) {
  if (activity === "walk") return Math.max(1, Math.round(osrmSeconds));
  if (activity === "bike") return Math.max(1, Math.round(osrmSeconds));
  return Math.max(1, Math.round((distanceKm / 10) * 3600));
}

function placeLabel(name: string) {
  return name.split(",")[0]!.trim().slice(0, 120) || "Place";
}

async function readJson(
  response: Response,
  label: string,
): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`${label} is unavailable right now. Try again shortly.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error(`${label} returned an empty response.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw Error(`${label} returned too much data.`);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error(`${label} returned an unreadable response.`);
  }
}

export async function planRoute(
  input: RouteRequest,
  deps: {
    fetch?: typeof fetch;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
    signal?: AbortSignal;
  } = {},
): Promise<PlannedRoute> {
  const request = routeRequestSchema.parse(input);
  const transport = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const wait =
    deps.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const queries = [
    request.start,
    ...(request.via ?? []),
    request.end,
  ];
  const stops: RouteStop[] = [];
  let lastNominatim = 0;
  for (const query of queries) {
    const pause = lastNominatim ? 1100 - (now() - lastNominatim) : 0;
    if (pause > 0) await wait(pause);
    lastNominatim = now();
    const url = new URL(NOMINATIM);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", query);
    const response = await transport(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      redirect: "error",
      signal: deps.signal ?? AbortSignal.timeout(8000),
    });
    const hits = z.array(nominatimHit).min(1).safeParse(
      await readJson(response, "Place lookup"),
    );
    if (!hits.success)
      throw Error(
        `Could not find “${query.slice(0, 80)}”. Try a more specific place, neighbourhood or street.`,
      );
    const hit = hits.data[0]!;
    const lat = Number(hit.lat),
      lng = Number(hit.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      throw Error("That place lookup returned an invalid location.");
    stops.push({ lat, lng, label: placeLabel(hit.display_name) });
  }
  const profile = request.activity === "bike" ? "bike" : "foot";
  const coords = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(";");
  const osrm = await transport(
    `${OSRM}/${profile}/${coords}?overview=simplified&geometries=geojson&steps=false`,
    {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      redirect: "error",
      signal: deps.signal ?? AbortSignal.timeout(8000),
    },
  );
  const routed = osrmResponse.safeParse(await readJson(osrm, "Route planning"));
  if (!routed.success || routed.data.code !== "Ok")
    throw Error(
      "No public walking or cycling route could be found between those places. Try closer, named streets or a different end point.",
    );
  const route = routed.data.routes[0]!;
  const path = simplifyPath(
    route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  );
  const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
  if (distanceKm <= 0 || distanceKm > 200)
    throw Error("That route is outside the 200 km planning limit.");
  const activityLabel =
    request.activity === "bike"
      ? "ride"
      : request.activity === "walk"
        ? "walk"
        : "run";
  return {
    title:
      request.title ??
      `${stops[0]!.label} to ${stops[stops.length - 1]!.label}`,
    activity: request.activity,
    distanceKm,
    durationSeconds: estimateDuration(
      request.activity,
      distanceKm,
      route.duration,
    ),
    stops,
    path,
    caption: `Suggested ${activityLabel} on public OpenStreetMap roads. This is not GPS navigation, a traffic check or a logged activity.`,
  };
}
