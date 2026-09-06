import assert from "node:assert/strict";
// Read-only, unauthenticated probes. Never supply production cookies or print response bodies.
const base =
  process.argv[2] ?? "https://lift-journal-production.up.railway.app";
const paths = [
  "/",
  "/privacy",
  "/api/session",
  "/api/auth/get-session",
  "/api/auth/list-sessions",
  "/api/auth/list-users",
  "/api/journal",
  "/api/agent",
  "/api/images",
  "/api/images?category=sleep",
  "/api/food/photos",
  "/api/images/00000000-0000-4000-8000-000000000000",
  "/users",
  "/profile",
  "/admin",
  "/.env",
  "/.env.local",
  "/.git/config",
  "/artifacts",
  "/drizzle",
  "/migrate.cjs",
  "/api/health",
  "/api/ready",
];
for (const path of paths) {
  const r = await fetch(base + path, {
    redirect: "manual",
    headers: {
      "X-Journal-Account": "unauthenticated-audit",
      Origin: "https://untrusted.example",
    },
  });
  const body = await r.text();
  console.log(
    JSON.stringify({
      path,
      status: r.status,
      cache: r.headers.get("cache-control"),
      cors: r.headers.get("access-control-allow-origin"),
      bytes: Buffer.byteLength(body),
    }),
  );
  if (
    [
      "/api/journal",
      "/api/agent",
      "/api/images",
      "/api/images?category=sleep",
      "/api/food/photos",
    ].includes(path)
  )
    assert.equal(r.status, 401);
  if (path === "/api/session") assert.equal(JSON.parse(body).user, null);
  if (path === "/") {
    assert.match(body, /Your health/);
    assert.doesNotMatch(body, /class="private-shell/);
    assert.ok(r.headers.get("strict-transport-security"));
  }
  if (
    [
      "/api/auth/list-sessions",
      "/api/images/00000000-0000-4000-8000-000000000000",
    ].includes(path)
  )
    assert.equal(r.status, 401);
  if (path === "/api/auth/list-users") assert.equal(r.status, 404);
  if (
    [
      "/api/session",
      "/api/journal",
      "/api/agent",
      "/api/images",
      "/api/food/photos",
    ].includes(path)
  )
    assert.match(r.headers.get("cache-control") ?? "", /private, no-store/);
  if (path === "/api/auth/get-session") assert.equal(JSON.parse(body), null);
  if (
    [
      "/users",
      "/profile",
      "/admin",
      "/.env",
      "/.env.local",
      "/.git/config",
      "/artifacts",
      "/drizzle",
      "/migrate.cjs",
    ].includes(path)
  )
    assert.equal(r.status, 404);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
}
