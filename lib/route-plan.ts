import { z } from "zod";

export const routeActivitySchema = z.enum(["run", "walk", "bike"]);
export type RouteActivity = z.infer<typeof routeActivitySchema>;
export const routeDirectionSchema = z.enum([
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
]);
export type RouteDirection = z.infer<typeof routeDirectionSchema>;
export const routeParkBiasSchema = z.enum(["none", "some", "high"]);
export type RouteParkBias = z.infer<typeof routeParkBiasSchema>;
export const routeRequestSchema = z
  .object({
    start: z.string().trim().min(2).max(200),
    end: z.string().trim().min(2).max(200).optional(),
    via: z.array(z.string().trim().min(2).max(200)).max(3).optional(),
    activity: routeActivitySchema,
    targetKm: z.number().finite().min(0.5).max(80).optional(),
    // Heading to travel toward. Without it a loop encircles the start, which
    // is wrong when someone asks to head out of town in one direction.
    direction: routeDirectionSchema.optional(),
    // How hard to pull the route onto green paths. preferParks is the older
    // boolean form and still maps onto this.
    parkBias: routeParkBiasSchema.optional(),
    preferParks: z.boolean().optional(),
    // Same request, different route. Repeat asks must not return the previous
    // route unchanged, so this shifts the bearings and the park pairing.
    variant: z.number().int().min(0).max(5).optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.end || value.targetKm), {
    message: "Provide an end place or a target distance in kilometres.",
  });
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteStop = { lat: number; lng: number; label: string };
export type PlannedRoute = {
  title: string;
  activity: RouteActivity;
  distanceKm: number;
  durationSeconds: number;
  targetKm?: number;
  loop?: boolean;
  stops: RouteStop[];
  path: [number, number][];
  caption: string;
};

const MAX_PATH = 180;
const MAX_BYTES = 256000;
const EARTH_KM = 6371;
const PARK_HINT =
  /\b(park|parks|have|haven|sø|soen|lake|lakes|forest|skov|trail|green|garden|gardens|fælled|common|nature|woods)\b/i;

const DIRECTION_BEARINGS: Record<RouteDirection, number> = {
  north: 0,
  northeast: 45,
  east: 90,
  southeast: 135,
  south: 180,
  southwest: 225,
  west: 270,
  northwest: 315,
};

// A park is used when it sits within this distance of the shape's next corner.
// The old fixed window was narrow enough that real parks were usually found
// and then discarded, leaving a plain geometric circle.
function parkSnapKm(bias: RouteParkBias, radiusKm: number) {
  return bias === "high"
    ? Math.max(1, radiusKm * 1.6)
    : Math.max(0.5, radiusKm * 0.9);
}

export function googleMapsKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

const geocodeResult = z.object({
  formatted_address: z.string().min(1),
  types: z.array(z.string()).optional(),
  geometry: z.object({
    location: z.object({
      lat: z.number().finite(),
      lng: z.number().finite(),
    }),
  }),
});
const geocodeResponse = z.object({
  status: z.string(),
  results: z.array(geocodeResult),
});
const placeResult = z.object({
  name: z.string().min(1),
  types: z.array(z.string()).optional(),
  geometry: z.object({
    location: z.object({
      lat: z.number().finite(),
      lng: z.number().finite(),
    }),
  }),
});
const nearbyResponse = z.object({
  status: z.string(),
  results: z.array(placeResult).optional(),
});
const directionsResponse = z.object({
  status: z.string(),
  routes: z
    .array(
      z.object({
        overview_polyline: z.object({ points: z.string().min(1) }),
        legs: z
          .array(
            z.object({
              distance: z.object({ value: z.number().finite().nonnegative() }),
              duration: z.object({ value: z.number().finite().nonnegative() }),
            }),
          )
          .min(1),
      }),
    )
    .optional(),
});

export function simplifyPath(
  points: [number, number][],
  max = MAX_PATH,
): [number, number][] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const path: [number, number][] = [];
  for (let i = 0; i < max - 1; i++) path.push(points[Math.round(i * step)]!);
  path.push(points[points.length - 1]!);
  return path;
}

export function decodePolyline(encoded: string): [number, number][] {
  let index = 0,
    lat = 0,
    lng = 0;
  const path: [number, number][] = [];
  while (index < encoded.length) {
    let result = 0,
      shift = 0,
      byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    path.push([lat / 1e5, lng / 1e5]);
  }
  return path;
}

export function kmBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function offsetPoint(
  lat: number,
  lng: number,
  distanceKm: number,
  bearingDeg: number,
): RouteStop {
  const bearing = (bearingDeg * Math.PI) / 180;
  const fromLat = (lat * Math.PI) / 180;
  const fromLng = (lng * Math.PI) / 180;
  const angular = distanceKm / EARTH_KM;
  const toLat = Math.asin(
    Math.sin(fromLat) * Math.cos(angular) +
      Math.cos(fromLat) * Math.sin(angular) * Math.cos(bearing),
  );
  const toLng =
    fromLng +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(fromLat),
      Math.cos(angular) - Math.sin(fromLat) * Math.sin(toLat),
    );
  return {
    lat: (toLat * 180) / Math.PI,
    lng: (((toLng * 180) / Math.PI + 540) % 360) - 180,
    label: "Waypoint",
  };
}

export function estimateDuration(
  activity: RouteActivity,
  distanceKm: number,
  routedSeconds: number,
) {
  if (activity === "walk" || activity === "bike")
    return Math.max(1, Math.round(routedSeconds));
  return Math.max(1, Math.round((distanceKm / 10) * 3600));
}

function placeLabel(name: string) {
  return name.split(",")[0]!.trim().slice(0, 120) || "Place";
}

function looksLikePark(text: string, types: string[] = []) {
  return (
    PARK_HINT.test(text) ||
    types.some((type) =>
      ["park", "campground", "natural_feature"].includes(type),
    )
  );
}

function km(value: number) {
  return Math.round(value * 100) / 100;
}

async function readJson(response: Response, label: string): Promise<unknown> {
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

type MapsClient = {
  key: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
};

function mapsUrl(path: string, key: string, params: Record<string, string>) {
  const url = new URL(`https://maps.googleapis.com/maps/api/${path}/json`);
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  return url;
}

async function geocode(client: MapsClient, query: string): Promise<RouteStop> {
  const response = await client.fetch(
    mapsUrl("geocode", client.key, { address: query }),
    { redirect: "error", signal: client.signal ?? AbortSignal.timeout(8000) },
  );
  const body = geocodeResponse.safeParse(
    await readJson(response, "Place lookup"),
  );
  const hit = body.success && body.data.status === "OK" ? body.data.results[0] : undefined;
  if (!hit)
    throw Error(
      `Could not find “${query.slice(0, 80)}”. Try a more specific park, street or neighbourhood.`,
    );
  const { lat, lng } = hit.geometry.location;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw Error("That place lookup returned an invalid location.");
  return {
    lat,
    lng,
    label: placeLabel(hit.formatted_address),
  };
}

async function nearbyParks(
  client: MapsClient,
  center: RouteStop,
  query: string,
  targetKm?: number,
): Promise<RouteStop[]> {
  const radius = Math.round(
    Math.min(8000, Math.max(1200, (targetKm ?? 5) * 600)),
  );
  const lake = /\b(sø|soen|lake|lakes)\b/i.test(query);
  const response = await client.fetch(
    mapsUrl("place/nearbysearch", client.key, {
      location: `${center.lat},${center.lng}`,
      radius: String(radius),
      ...(lake ? {} : { type: "park" }),
      keyword: query.slice(0, 80),
    }),
    { redirect: "error", signal: client.signal ?? AbortSignal.timeout(8000) },
  );
  const body = nearbyResponse.safeParse(
    await readJson(response, "Park lookup"),
  );
  if (!body.success || !["OK", "ZERO_RESULTS"].includes(body.data.status))
    return [];
  const seen = new Set<string>();
  return (body.data.results ?? [])
    .filter(
      (place) =>
        looksLikePark(place.name, place.types) ||
        (place.types ?? []).some((type) =>
          ["park", "campground", "natural_feature"].includes(type),
        ),
    )
    .map((place) => ({
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      label: placeLabel(place.name),
    }))
    .filter((place) => {
      const key = `${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return kmBetween(place, center) > 0.08;
    })
    .slice(0, 6);
}

async function directions(
  client: MapsClient,
  origin: RouteStop,
  destination: RouteStop,
  waypoints: RouteStop[],
  activity: RouteActivity,
) {
  const mode = activity === "bike" ? "bicycling" : "walking";
  const params: Record<string, string> = {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode,
    alternatives: "false",
  };
  if (activity !== "bike") params.avoid = "highways";
  if (waypoints.length)
    params.waypoints = waypoints
      .map((point) => `via:${point.lat},${point.lng}`)
      .join("|");
  const response = await client.fetch(mapsUrl("directions", client.key, params), {
    redirect: "error",
    signal: client.signal ?? AbortSignal.timeout(8000),
  });
  const body = directionsResponse.safeParse(
    await readJson(response, "Route planning"),
  );
  const route =
    body.success && body.data.status === "OK" ? body.data.routes?.[0] : undefined;
  if (!route)
    throw Error(
      "No walking or cycling route could be found for those places. Try a named park, a closer end point, or a shorter distance.",
    );
  const metres = route.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
  const seconds = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
  const path = simplifyPath(decodePolyline(route.overview_polyline.points));
  if (path.length < 2) throw Error("That route could not be drawn on the map.");
  return {
    distanceKm: km(metres / 1000),
    durationSeconds: Math.max(1, Math.round(seconds)),
    path,
  };
}

function closeEnough(actual: number, target: number) {
  return Math.abs(actual - target) / target <= 0.08;
}

type LoopShape = {
  direction?: RouteDirection;
  variant: number;
  parkBias: RouteParkBias;
};

// Without a direction this is a ring around the start. With one it is a lobe
// that reaches out along the heading and comes back, so "north" travels north
// instead of circling the whole city.
function loopCorners(start: RouteStop, radiusKm: number, shape: LoopShape) {
  if (shape.direction === undefined)
    return [30, 120, 210, 300].map((bearing, i) => ({
      ...offsetPoint(start.lat, start.lng, radiusKm, bearing + shape.variant * 37),
      label: `Turn ${i + 1}`,
    }));
  const axis =
    DIRECTION_BEARINGS[shape.direction] + ((shape.variant % 3) - 1) * 18;
  const spread = 32 + (shape.variant % 2) * 14;
  return [
    { bearing: axis - spread, reach: 0.6 },
    { bearing: axis, reach: 1 },
    { bearing: axis + spread, reach: 0.6 },
  ].map((corner, i) => ({
    ...offsetPoint(start.lat, start.lng, radiusKm * corner.reach, corner.bearing),
    label: `Turn ${i + 1}`,
  }));
}

function loopWaypoints(
  start: RouteStop,
  parks: RouteStop[],
  radiusKm: number,
  shape: LoopShape,
) {
  const corners = loopCorners(start, radiusKm, shape);
  if (!parks.length || shape.parkBias === "none") return corners;
  const unused = [...parks];
  const snapKm = parkSnapKm(shape.parkBias, radiusKm);
  const chosen = [...corners];
  // Pairing starts at a different corner per variant, so a repeat request
  // routes through the parks in a different order rather than identically.
  for (let step = 0; step < corners.length; step++) {
    const index = (step + shape.variant) % corners.length;
    const point = corners[index]!;
    let best = -1;
    let bestKm = Infinity;
    unused.forEach((park, at) => {
      const distance = kmBetween(point, park);
      if (distance < bestKm) {
        bestKm = distance;
        best = at;
      }
    });
    if (best < 0 || bestKm > snapKm) continue;
    const [park] = unused.splice(best, 1);
    chosen[index] = park!;
  }
  return chosen;
}

async function loopRoute(
  client: MapsClient,
  start: RouteStop,
  parks: RouteStop[],
  activity: RouteActivity,
  targetKm: number,
  shape: LoopShape,
) {
  let scale = 0.9;
  let best:
    | Awaited<ReturnType<typeof directions>> & { waypoints: RouteStop[] }
    | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    // A ring's perimeter is its circumference; an out-and-back lobe covers the
    // reach roughly twice. Either way the loop below corrects the scale.
    const radius =
      (shape.direction === undefined
        ? targetKm / (2 * Math.PI)
        : targetKm / 2.4) * scale;
    const waypoints = loopWaypoints(start, parks, radius, shape);
    const routed = await directions(client, start, start, waypoints, activity);
    const candidate = { ...routed, waypoints };
    if (
      !best ||
      Math.abs(candidate.distanceKm - targetKm) <
        Math.abs(best.distanceKm - targetKm)
    )
      best = candidate;
    if (closeEnough(candidate.distanceKm, targetKm)) return candidate;
    scale *= targetKm / Math.max(0.4, candidate.distanceKm);
    scale = Math.min(1.85, Math.max(0.45, scale));
  }
  if (!best) throw Error("Could not build a loop of that distance.");
  return best;
}

async function pointToPoint(
  client: MapsClient,
  start: RouteStop,
  end: RouteStop,
  via: RouteStop[],
  parks: RouteStop[],
  activity: RouteActivity,
  targetKm?: number,
  direction?: RouteDirection,
) {
  const prefer = parks.filter(
    (park) =>
      (Math.abs(park.lat - start.lat) > 0.0005 ||
        Math.abs(park.lng - start.lng) > 0.0005) &&
      (Math.abs(park.lat - end.lat) > 0.0005 ||
        Math.abs(park.lng - end.lng) > 0.0005),
  );
  let waypoints = [...via, ...prefer].slice(0, 3);
  let routed = await directions(client, start, end, waypoints, activity);
  if (!targetKm || closeEnough(routed.distanceKm, targetKm))
    return { ...routed, waypoints };
  if (routed.distanceKm > targetKm)
    return { ...routed, waypoints };
  const extra = Math.max(0.3, (targetKm - routed.distanceKm) / 2);
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;
  // Bulge toward the requested heading when there is one, otherwise sideways
  // from the straight line between the two places.
  const detour = offsetPoint(
    midLat,
    midLng,
    extra,
    direction === undefined
      ? 90 +
          (Math.atan2(end.lng - start.lng, end.lat - start.lat) * 180) /
            Math.PI
      : DIRECTION_BEARINGS[direction],
  );
  waypoints = [...waypoints, { ...detour, label: "Park loop" }].slice(0, 4);
  routed = await directions(client, start, end, waypoints, activity);
  return { ...routed, waypoints };
}

export async function planRoute(
  input: RouteRequest,
  deps: {
    fetch?: typeof fetch;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PlannedRoute> {
  const request = routeRequestSchema.parse(input);
  const key = deps.key ?? googleMapsKey();
  if (!key)
    throw Error(
      "Google Maps is not connected yet. The app owner needs to add a Maps API key.",
    );
  const client: MapsClient = {
    key,
    fetch: deps.fetch ?? fetch,
    signal: deps.signal,
  };
  const start = await geocode(client, request.start);
  const end = request.end ? await geocode(client, request.end) : undefined;
  const via = await Promise.all(
    (request.via ?? []).map((place) => geocode(client, place)),
  );
  const samePlace =
    !end ||
    (Math.abs(start.lat - end.lat) < 0.0004 &&
      Math.abs(start.lng - end.lng) < 0.0004);
  // An explicit park request, in either the new or the older boolean form.
  const explicitParks = request.parkBias
    ? request.parkBias !== "none"
    : request.preferParks === true;
  const nearbyGreenEnds = Boolean(
    end &&
      request.targetKm &&
      kmBetween(start, end) < Math.min(1.5, request.targetKm * 0.25) &&
      (explicitParks ||
        (looksLikePark(request.start) && looksLikePark(request.end ?? ""))),
  );
  const loop = samePlace || nearbyGreenEnds;
  if (loop && !request.targetKm)
    throw Error(
      "A loop needs a target distance, for example 5 km around that park.",
    );
  const parkBias: RouteParkBias =
    request.parkBias ??
    (request.preferParks === true ||
    looksLikePark(request.start) ||
    looksLikePark(request.end ?? "")
      ? "some"
      : "none");
  const parks =
    parkBias === "none"
      ? []
      : await nearbyParks(client, start, request.start, request.targetKm);
  const variant = request.variant ?? 0;
  const routed = loop
    ? await loopRoute(
        client,
        start,
        parks,
        request.activity,
        request.targetKm!,
        { direction: request.direction, variant, parkBias },
      )
    : await pointToPoint(
        client,
        start,
        end!,
        via,
        parks,
        request.activity,
        request.targetKm,
        request.direction,
      );
  if (routed.distanceKm <= 0 || routed.distanceKm > 200)
    throw Error("That route is outside the 200 km planning limit.");
  const activityLabel =
    request.activity === "bike"
      ? "ride"
      : request.activity === "walk"
        ? "walk"
        : "run";
  const namedStops: RouteStop[] = loop
    ? [
        start,
        ...routed.waypoints.filter((point) => point.label !== "Waypoint"),
        { ...start, label: "Finish" },
      ].slice(0, 5)
    : [start, ...via, ...routed.waypoints.filter((point) => point.label !== "Waypoint" && point.label !== "Turn 1" && !point.label.startsWith("Turn ")), end!].filter(
        (point, index, all) =>
          index === 0 ||
          index === all.length - 1 ||
          point.label !== all[index - 1]?.label,
      ).slice(0, 5);
  const uniqueStops = namedStops.filter(
    (point, index) =>
      index === 0 ||
      index === namedStops.length - 1 ||
      !point.label.startsWith("Turn "),
  );
  const stops = (uniqueStops.length >= 2 ? uniqueStops : [start, end ?? start]).slice(
    0,
    5,
  );
  const targetNote = request.targetKm
    ? `Requested ${request.targetKm.toFixed(1)} km · planned ${routed.distanceKm.toFixed(1)} km`
    : `${routed.distanceKm.toFixed(1)} km`;
  const parkNote =
    parkBias === "high"
      ? " Pulled onto parks and green paths wherever Google Maps has them."
      : parkBias === "some"
        ? " Prefers parks and green paths when Google Maps has them."
        : "";
  const directionNote = request.direction
    ? ` Heads ${request.direction} from the start.`
    : "";
  return {
    title:
      request.title ??
      (loop
        ? `${request.targetKm?.toFixed(1) ?? routed.distanceKm.toFixed(1)} km ${
            request.direction ? `${request.direction} from` : "around"
          } ${start.label}`
        : `${start.label} to ${end!.label}`),
    activity: request.activity,
    distanceKm: routed.distanceKm,
    durationSeconds: estimateDuration(
      request.activity,
      routed.distanceKm,
      routed.durationSeconds,
    ),
    targetKm: request.targetKm,
    loop,
    stops,
    path: routed.path,
    caption: `${targetNote} ${activityLabel} on Google Maps.${directionNote}${parkNote} Not GPS navigation or a logged activity.`,
  };
}
