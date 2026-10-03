import http2 from "node:http2";
import { createEndpointHandler } from "@restatedev/restate-sdk";
import { logFailure } from "../error-log";
import { restateEndpointConfig } from "./config";
import { ping } from "./ping";

// The services Restate may call here. Never rename one, or a handler, in
// place: register a new name and keep the old one for a deploy.
export const services = [ping];

const KEY = Symbol.for("lift.restate.endpoint");
const shared = globalThis as unknown as Record<
  symbol,
  http2.Http2Server | undefined
>;

// Started from instrumentation.ts with RESTATE_ENDPOINT=1. A failure to
// listen is logged and leaves the app serving; Restate then retries its calls.
export function startRestateEndpoint() {
  if (shared[KEY]) return shared[KEY];
  const config = restateEndpointConfig();
  if ("disabled" in config) {
    console.warn(
      JSON.stringify({
        event: "restate_endpoint_disabled",
        reason: config.disabled,
      }),
    );
    return undefined;
  }
  const server = http2.createServer(
    createEndpointHandler({ services, identityKeys: config.identityKeys }),
  );
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  server.on("error", (error) =>
    logFailure("restate_endpoint_failed", error, { port: config.port }),
  );
  server.listen(config.port, config.host, () =>
    console.info(
      JSON.stringify({
        event: "restate_endpoint_started",
        port: config.port,
        signed: config.identityKeys.length > 0,
      }),
    ),
  );
  // On a deploy, GOAWAY tells Restate to open new connections, which reach
  // the new container. Next.js then exits once its own requests are done,
  // without waiting for calls here (within milliseconds when idle); Restate
  // retries whatever was cut off on the new container.
  process.once("SIGTERM", () => {
    server.close();
    for (const session of sessions) session.close();
    // Without Next.js's own handler (NEXT_MANUAL_SIG_HANDLE), keep the
    // default of exiting.
    if (process.listenerCount("SIGTERM") === 0) process.exit(143);
  });
  shared[KEY] = server;
  return server;
}
