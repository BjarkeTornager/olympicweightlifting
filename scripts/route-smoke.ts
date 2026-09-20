// Opt-in real-model verification of Coach's route planning. Never use
// production records or a production database.
//
// The model provider is real: this checks that Coach itself chooses direction,
// parkBias and variant from an ordinary sentence. Google Maps is stubbed, so
// the check spends no Maps quota and does not depend on real-world geography.
import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
config({ path: ".env.local", quiet: true });
if (
  process.env.ROUTE_SMOKE !== "true" ||
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw Error(
    "Explicit ROUTE_SMOKE=true and a disposable _test database are required.",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (
  process.env.AGENT_PROVIDER === "openrouter" &&
  !process.env.OPENROUTER_API_KEY
)
  process.env.OPENROUTER_API_KEY = (
    await readFile(homedir() + "/.config/lift-journal/openrouter.key", "utf8")
  ).trim();
// Stubbed below, so this never reaches Google.
process.env.GOOGLE_MAPS_API_KEY = "synthetic-route-smoke-key";

const START = { lat: 55.6761, lng: 12.5683 };
const PARKS = [
  { name: "Nørrebroparken", lat: 55.6905, lng: 12.546 },
  { name: "Fælledparken", lat: 55.7036, lng: 12.5681 },
  { name: "Amager Fælled", lat: 55.658, lng: 12.58 },
];
type Leg = { via: { lat: number; lng: number }[] };
const legs: Leg[] = [];
const realFetch = globalThis.fetch;
const reply = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = decodeURIComponent(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (!href.includes("maps.googleapis.com")) return realFetch(input, init);
  if (href.includes("/geocode/"))
    return reply({
      status: "OK",
      results: [
        {
          formatted_address: "Copenhagen, Denmark",
          types: ["locality"],
          geometry: { location: START },
        },
      ],
    });
  if (href.includes("/place/nearbysearch/"))
    return reply({
      status: "OK",
      results: PARKS.map((park) => ({
        name: park.name,
        types: ["park"],
        geometry: { location: { lat: park.lat, lng: park.lng } },
      })),
    });
  legs.push({
    via: [...href.matchAll(/via:([\d.-]+),([\d.-]+)/g)].map((match) => ({
      lat: Number(match[1]),
      lng: Number(match[2]),
    })),
  });
  return reply({
    status: "OK",
    routes: [
      {
        overview_polyline: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
        legs: [{ distance: { value: 30100 }, duration: { value: 5400 } }],
      },
    ],
  });
}) as typeof fetch;

const { providerConfig } = await import("../lib/agent/provider");
if (!providerConfig())
  throw Error("Configure the approved model provider for this opt-in check.");
const { getPool } = await import("../lib/db"),
  { runTurn } = await import("../lib/agent/engine");

const pool = getPool(),
  id = crypto.randomUUID();
const shape = (leg: Leg | undefined) =>
  JSON.stringify(
    (leg?.via ?? []).map((p) => [p.lat.toFixed(4), p.lng.toFixed(4)]),
  );
let stage = "setup";
try {
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Synthetic route check','route-smoke-'||$1||'@example.test',true)",
    [id],
  );

  stage = "a ride in a named direction";
  legs.length = 0;
  const north = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 0,
    timezone: "Europe/Copenhagen",
    message:
      "Plan me a 30 km bike ride heading north from Copenhagen. Show it on a map.",
  });
  const northMap = north.visuals?.find((v) => v.content.kind === "route_map");
  assert.ok(northMap, "Coach did not show a route map for a named direction.");
  const northLeg = legs.at(-1);
  assert.ok(northLeg?.via.length, "No route was requested from Maps.");
  assert.ok(
    northLeg.via.every((point) => point.lat > START.lat),
    `Coach did not send direction: waypoints were not north of the start (${shape(northLeg)}).`,
  );
  assert.match(
    northMap.content.caption,
    /Heads north/,
    "The planned route does not record a northern heading.",
  );
  console.log("ok  named direction ->", northMap.content.title);

  stage = "a different and greener route";
  const before = shape(legs.at(-1));
  legs.length = 0;
  const again = await runTurn(id, {
    id: crypto.randomUUID(),
    revision: 0,
    timezone: "Europe/Copenhagen",
    message:
      "That is the same route I always get. Give me a different one, and keep more of it inside parks.",
  });
  const againMap = again.visuals?.find((v) => v.content.kind === "route_map");
  assert.ok(againMap, "Coach did not show a new route map when asked again.");
  const againLeg = legs.at(-1);
  assert.ok(againLeg?.via.length, "No second route was requested from Maps.");
  assert.notEqual(
    shape(againLeg),
    before,
    "Coach returned the same route again: it did not vary the request.",
  );
  console.log("ok  refined request ->", againMap.content.title);
  console.log("\nRoute planning verified end to end with a real model.");
} catch (error) {
  console.error(`route smoke failed during: ${stage}`);
  throw error;
} finally {
  globalThis.fetch = realFetch;
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  await pool.end();
}
