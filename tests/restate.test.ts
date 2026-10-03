import { test } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { restateEndpointConfig } from "../lib/restate/config";
import {
  base58,
  newIdentityKey,
  restatePublicKey,
} from "../lib/restate/identity";
import { changes, deploymentChanges } from "../scripts/restate-register";

// The Restate endpoint (lib/restate): off by default, signed in production,
// HTTP/2 on its own port. No Restate server needed: requests are signed here
// the way Restate signs them.

// Only warnings and errors from the SDK, read when it loads.
process.env.RESTATE_LOGGING ??= "WARN";

const KEYS = "publickeyv1_9EbLBAp7bfPQYByv1fWTNnjG7XhCyRy333raprS5ABcr";

test("The endpoint is off unless RESTATE_ENDPOINT=1, and signed in production", () => {
  assert.deepEqual(restateEndpointConfig({}), { disabled: "off" });
  assert.deepEqual(restateEndpointConfig({ RESTATE_ENDPOINT: "true" }), {
    disabled: "off",
  });
  // Development: unsigned is allowed and it stays on this machine.
  assert.deepEqual(restateEndpointConfig({ RESTATE_ENDPOINT: "1" }), {
    port: 9080,
    host: "127.0.0.1",
    identityKeys: [],
  });
  const production = { RESTATE_ENDPOINT: "1", NODE_ENV: "production" };
  assert.deepEqual(restateEndpointConfig(production), {
    disabled: "missing_identity_keys",
  });
  assert.deepEqual(
    restateEndpointConfig({
      ...production,
      RESTATE_IDENTITY_KEYS: ` ${KEYS}, ${KEYS.replace("9E", "8E")} `,
    }),
    {
      port: 9080,
      host: "::",
      identityKeys: [KEYS, KEYS.replace("9E", "8E")],
    },
  );
  for (const [env, reason] of [
    [{ RESTATE_IDENTITY_KEYS: "publickeyv1_0OIl" }, "invalid_identity_key"],
    [{ RESTATE_IDENTITY_KEYS: KEYS.slice(12) }, "invalid_identity_key"],
    [{ RESTATE_ENDPOINT_PORT: "80000" }, "invalid_port"],
    [{ RESTATE_ENDPOINT_PORT: "9080.5" }, "invalid_port"],
    [{ RESTATE_ENDPOINT_PORT: "3000" }, "port_in_use"],
    [{ RESTATE_ENDPOINT_PORT: "8080", PORT: "8080" }, "port_in_use"],
  ] as const)
    assert.deepEqual(
      restateEndpointConfig({ RESTATE_ENDPOINT: "1", ...env }),
      { disabled: reason },
      JSON.stringify(env),
    );
  assert.deepEqual(
    restateEndpointConfig({
      RESTATE_ENDPOINT: "1",
      RESTATE_ENDPOINT_PORT: "9181",
      RESTATE_ENDPOINT_HOST: "::",
    }),
    { port: 9181, host: "::", identityKeys: [] },
  );
});

test("Signing keys are in Restate's publickeyv1 form", () => {
  // Bitcoin's alphabet, with a leading zero byte as "1".
  assert.equal(base58(Buffer.from("Hello World!")), "2NEpo7TZRRrLZSi2U");
  assert.equal(base58(Uint8Array.from([0, 0, 1])), "112");
  assert.equal(base58(new Uint8Array()), "");
  const key = newIdentityKey();
  assert.match(key.privateKeyPem, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.equal(restatePublicKey(key.privateKeyPem), key.publicKey);
  const config = restateEndpointConfig({
    RESTATE_ENDPOINT: "1",
    NODE_ENV: "production",
    RESTATE_IDENTITY_KEYS: key.publicKey,
  });
  assert.deepEqual("identityKeys" in config && config.identityKeys, [
    key.publicKey,
  ]);
  assert.throws(
    () => restatePublicKey(generateKeyPairSync("x25519").publicKey),
    /Ed25519/,
  );
});

// A request identity token as Restate makes one: EdDSA, the path as audience.
function signature(path: string, key: { privateKeyPem: string }) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${part({ alg: "EdDSA", typ: "JWT" })}.${part({
    aud: path,
    iat: now,
    nbf: now - 60,
    exp: now + 60,
  })}`;
  const signed = sign(
    null,
    Buffer.from(unsigned),
    createPrivateKey(key.privateKeyPem),
  );
  return {
    "x-restate-signature-scheme": "v1",
    "x-restate-jwt-v1": `${unsigned}.${signed.toString("base64url")}`,
  };
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(
  session: http2.ClientHttp2Session,
  path: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const stream = session.request({
      ":path": path,
      accept: "application/vnd.restate.endpointmanifest.v4+json",
      ...headers,
    });
    let status = 0;
    let body = "";
    stream.on("response", (h) => (status = Number(h[":status"])));
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => (body += chunk));
    stream.on("end", () => resolve({ status, body }));
    stream.on("error", reject);
    stream.end();
  });
}

test("The endpoint serves Ping over HTTP/2, only to Restate's signed calls, and sends GOAWAY on SIGTERM", async () => {
  const key = newIdentityKey();
  const port = await freePort();
  const listeners = process.listeners("SIGTERM");
  Object.assign(process.env, {
    RESTATE_ENDPOINT: "1",
    RESTATE_ENDPOINT_PORT: String(port),
    RESTATE_IDENTITY_KEYS: key.publicKey,
  });
  const { startRestateEndpoint } = await import("../lib/restate/endpoint");
  const server = startRestateEndpoint();
  try {
    assert.ok(server);
    // Once only, however often instrumentation runs.
    assert.equal(startRestateEndpoint(), server);
    if (!server.listening)
      await new Promise((resolve) => server.once("listening", resolve));
    const session = http2.connect(`http://127.0.0.1:${port}`);
    // Health needs no signature; discovery and calls do.
    assert.equal((await request(session, "/health")).status, 200);
    assert.equal((await request(session, "/discover")).status, 401);
    assert.equal(
      (
        await request(
          session,
          "/discover",
          signature("/discover", newIdentityKey()),
        )
      ).status,
      401,
    );
    assert.equal(
      (await request(session, "/discover", signature("/invoke/Ping/ping", key)))
        .status,
      401,
    );
    const discovered = await request(
      session,
      "/discover",
      signature("/discover", key),
    );
    assert.equal(discovered.status, 200);
    const manifest = JSON.parse(discovered.body);
    assert.equal(manifest.protocolMode, "BIDI_STREAM");
    assert.deepEqual(
      manifest.services.map(
        (s: { name: string; handlers: { name: string }[] }) => [
          s.name,
          s.handlers.map((h) => h.name),
        ],
      ),
      [["Ping", ["ping"]]],
    );
    // On SIGTERM: GOAWAY to open connections, and no new ones.
    const goaway = new Promise((resolve) => session.once("goaway", resolve));
    const added = process
      .listeners("SIGTERM")
      .filter((l) => !listeners.includes(l));
    assert.equal(added.length, 1);
    (added[0] as () => void)();
    await goaway;
    await new Promise((resolve) => server.once("close", resolve));
    assert.equal(server.listening, false);
    session.destroy();
  } finally {
    for (const l of process.listeners("SIGTERM"))
      if (!listeners.includes(l)) process.off("SIGTERM", l);
    server?.close();
    delete process.env.RESTATE_ENDPOINT;
    delete process.env.RESTATE_ENDPOINT_PORT;
    delete process.env.RESTATE_IDENTITY_KEYS;
  }
});

const service = (
  name: string,
  handlers: string[],
  settings: Record<string, unknown> = {},
) => ({
  name,
  ty: "Service",
  handlers: handlers.map((h) => ({ name: h })),
  deployment_id: "dp_1",
  revision: 1,
  journal_retention: "1h",
  ...settings,
});

test("Registration sees added, removed and changed handlers, and refuses a type change", () => {
  const ping = service("Ping", ["ping"]);
  assert.deepEqual(changes([ping], [{ ...ping, revision: 2 }]), []);
  assert.deepEqual(changes([ping], [service("Ping", ["ping", "echo"])]), [
    "+ Ping.echo",
  ]);
  assert.deepEqual(changes([service("Ping", ["ping", "echo"])], [ping]), [
    "- Ping.echo",
  ]);
  assert.deepEqual(
    changes([ping], [service("Ping", ["ping"], { journal_retention: "2h" })]),
    ["~ Ping settings"],
  );
  assert.deepEqual(
    changes(
      [ping],
      [
        ping,
        {
          ...service("CoachSession", ["drain"]),
          ty: "VirtualObject",
          handlers: [{ name: "drain", ty: "Exclusive" }],
        },
      ],
    ),
    ["+ CoachSession: drain (Exclusive)"],
  );
  assert.deepEqual(changes([ping, service("Old", ["run"])], [ping]), ["- Old"]);
  assert.throws(
    () => changes([ping], [{ ...ping, ty: "VirtualObject" }]),
    /never change a service's type in place/i,
  );
});

test("Registration sees a handler's own settings and a new SDK", () => {
  // A virtual object's handler as Restate lists it, with its own settings.
  const drain = (settings: Record<string, unknown> = {}) => ({
    ...service("CoachSession", []),
    ty: "VirtualObject",
    handlers: [
      {
        name: "drain",
        ty: "Exclusive",
        public: true,
        retry_policy: { max_attempts: null },
        ...settings,
      },
    ],
  });
  const before = drain();
  // The same settings in another order are no change.
  const reordered = {
    ...before,
    handlers: [
      {
        retry_policy: { max_attempts: null },
        public: true,
        ty: "Exclusive",
        name: "drain",
      },
    ],
  };
  assert.deepEqual(changes([before], [reordered]), []);
  for (const settings of [
    { retry_policy: { max_attempts: 5, on_max_attempts: "Kill" } },
    { inactivity_timeout: "5m" },
    { journal_retention: "2h" },
  ])
    assert.deepEqual(
      changes([before], [drain(settings)]),
      ["~ CoachSession.drain (Exclusive) settings"],
      JSON.stringify(settings),
    );
  const deployment = {
    id: "dp_1",
    services: [],
    sdk_version: "restate-sdk-typescript/1.17.2",
    min_protocol_version: 5,
    max_protocol_version: 7,
  };
  assert.deepEqual(deploymentChanges(deployment, { ...deployment }), []);
  assert.deepEqual(
    deploymentChanges(deployment, {
      ...deployment,
      sdk_version: "restate-sdk-typescript/1.18.0",
      max_protocol_version: 8,
    }),
    [
      "~ sdk_version: restate-sdk-typescript/1.17.2 to restate-sdk-typescript/1.18.0",
      "~ max_protocol_version: 7 to 8",
    ],
  );
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (["node_modules", ".next", "artifacts", "ios"].includes(name)) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : [];
  });

test("Only the endpoint loads the Restate SDK, and only with RESTATE_ENDPOINT=1", () => {
  const root = join(import.meta.dirname, "..");
  const importsSdk = /(?:from|import|require)\s*\(?\s*["']@restatedev\//;
  const importsEndpoint = /["'][^"']*lib\/restate\/(endpoint|ping)["']/;
  const files = [
    ...["app", "components", "lib", "scripts"].flatMap((dir) =>
      sourceFiles(join(root, dir)),
    ),
    ...["next.config.ts"].map((f) => join(root, f)),
  ];
  for (const file of files) {
    const path = relative(root, file);
    const source = readFileSync(file, "utf8");
    if (path === "lib/restate/endpoint.ts" || path === "lib/restate/ping.ts")
      continue;
    assert.doesNotMatch(source, importsSdk, path);
    if (!path.startsWith("lib/restate/"))
      assert.doesNotMatch(source, importsEndpoint, path);
  }
  // instrumentation.ts imports it on its own line, inside the flag's block.
  const instrumentation = readFileSync(
    join(root, "instrumentation.ts"),
    "utf8",
  );
  assert.doesNotMatch(instrumentation, importsSdk);
  assert.doesNotMatch(instrumentation, /^import .*lib\/restate/m);
  const block = instrumentation.match(
    /process\.env\.RESTATE_ENDPOINT === "1"\s*\)\s*\{([\s\S]*?)\n  \}/,
  );
  assert.ok(block, "the RESTATE_ENDPOINT block");
  assert.match(block[1], /import\("\.\/lib\/restate\/endpoint"\)/);
  assert.equal(
    instrumentation.match(/lib\/restate\//g)?.length,
    1,
    "lib/restate is imported only there",
  );
});
