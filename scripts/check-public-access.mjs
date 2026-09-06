import assert from "node:assert/strict";
// Read-only, unauthenticated probes. Never supply production cookies or print response bodies.
const base =
  process.argv[2] ?? "https://lift-journal-production.up.railway.app";
const paths = [
  "/",
  "/privacy",
  "/mobile",
  "/api/mobile/overview?date=2026-09-06",
  "/api/session",
  "/api/auth/get-session",
  "/api/auth/list-sessions",
  "/api/auth/list-users",
  "/api/invitations",
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
      "/api/invitations",
      "/api/mobile/overview?date=2026-09-06",
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
      "/api/invitations",
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
// AG-UI is an authenticated POST stream. Probe without a cookie or content;
// authentication must deny it before any model run can start.
for (const path of [
  "/api/agent/run",
  "/api/mobile/authorize",
  "/api/mobile/prepare",
]) {
  for (const origin of [new URL(base).origin, "https://untrusted.example"]) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Journal-Account": "unauthenticated-audit",
      },
      body: "{}",
    });
    assert.equal(response.status, origin === new URL(base).origin ? 401 : 403);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.doesNotMatch(
      response.headers.get("content-type") ?? "",
      /event-stream/,
    );
    console.log(
      JSON.stringify({
        path,
        method: "POST",
        trustedOrigin: origin === new URL(base).origin,
        status: response.status,
      }),
    );
  }
}
// Invitation changes must fail before parsing a body or touching membership.
for (const method of ["POST", "DELETE"]) {
  for (const origin of [new URL(base).origin, "https://untrusted.example"]) {
    const r = await fetch(`${base}/api/invitations`, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Journal-Account": "unauthenticated-audit",
      },
      body: "{}",
    });
    assert.equal(r.status, origin === new URL(base).origin ? 401 : 403);
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
    console.log(
      JSON.stringify({
        path: "/api/invitations",
        method,
        trustedOrigin: origin === new URL(base).origin,
        status: r.status,
      }),
    );
  }
}
