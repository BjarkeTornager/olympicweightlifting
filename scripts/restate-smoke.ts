// Checks the Restate endpoint in the standalone build, as production runs it
// (docs/restate-setup.md). CI runs it after `npm run build`:
//
//   node --import tsx scripts/restate-smoke.ts
//
// The SDK and its WASM are bundled into a server chunk that loads only with
// RESTATE_ENDPOINT=1, and the app keeps serving if it fails, so nothing else
// would notice a build that breaks it. This starts .next/standalone/server.js
// with the endpoint on and checks health, that discovery needs a valid
// signature (which the WASM checks), and that SIGTERM stops the server with
// 143. No database and no Restate server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http2 from "node:http2";
import { createServer } from "node:net";
import { newIdentityKey, restateSignature } from "../lib/restate/identity";

export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function request(
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

async function within<T>(ms: number, promise: Promise<T>, what: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`${what} took over ${ms / 1000} s`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const key = newIdentityKey();
  const port = await freePort();
  // Only what the server needs, so local settings (workers, tracing, a
  // database) stay out. RESTATE_LOGGING is unset, as in production.
  const server = spawn(process.execPath, [".next/standalone/server.js"], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(await freePort()),
      RESTATE_ENDPOINT: "1",
      RESTATE_ENDPOINT_PORT: String(port),
      RESTATE_ENDPOINT_HOST: "127.0.0.1",
      RESTATE_IDENTITY_KEYS: key.publicKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = new Promise<number | null>((resolve) =>
    server.once("exit", (code) => resolve(code)),
  );
  // The first line about the endpoint, once it is complete.
  const endpointLine = new Promise<string>((resolve, reject) => {
    const read = (chunk: Buffer) => {
      output += chunk;
      const line = output
        .split("\n")
        .slice(0, -1)
        .find((l) => l.includes('"event":"restate_endpoint_'));
      if (line) resolve(line);
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    void exited.then((code) =>
      reject(Error(`The server exited with ${code} first`)),
    );
  });
  try {
    const line = await within(60000, endpointLine, "Starting the endpoint");
    assert.deepEqual(JSON.parse(line), {
      event: "restate_endpoint_started",
      port,
      signed: true,
    });
    const session = http2.connect(`http://127.0.0.1:${port}`);
    session.on("error", () => {});
    assert.equal((await request(session, "/health")).status, 200, "/health");
    assert.equal(
      (await request(session, "/discover")).status,
      401,
      "unsigned /discover",
    );
    const discovered = await request(
      session,
      "/discover",
      restateSignature("/discover", key.privateKeyPem),
    );
    assert.equal(discovered.status, 200, "signed /discover");
    assert.deepEqual(
      JSON.parse(discovered.body).services.map(
        (s: { name: string; handlers: { name: string }[] }) => [
          s.name,
          s.handlers.map((h) => h.name),
        ],
      ),
      [["Ping", ["ping"]]],
    );
    // Next.js's handler exits as soon as its own requests are done, often
    // before the endpoint's GOAWAY reaches the client, so only the exit is
    // checked here; tests/restate.test.ts checks the GOAWAY.
    server.kill("SIGTERM");
    assert.equal(
      await within(15000, exited, "Exiting after SIGTERM"),
      143,
      "exit code after SIGTERM",
    );
    session.destroy();
  } catch (error) {
    server.kill("SIGKILL");
    throw Error(
      `${error instanceof Error ? error.message : error}\n\nServer output:\n${output}`,
    );
  }
  console.log(
    "The standalone build started the Restate endpoint, which answered health and signed discovery, refused unsigned discovery, and stopped on SIGTERM.",
  );
}

if (process.argv[1] && /restate-smoke\.ts$/.test(process.argv[1]))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
