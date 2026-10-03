// The Restate endpoint inside the app (docs/restate-setup.md). Off unless
// RESTATE_ENDPOINT=1: instrumentation.ts then loads nothing from lib/restate
// and the SDK never loads.
//
// It is a separate HTTP/2 server, not a Next.js route: over HTTP/1.1 Restate
// would suspend and replay the handler at every step.

export type RestateEndpointConfig = {
  port: number;
  host: string;
  // Public keys of the Restate servers allowed to call; requests without a
  // valid signature from one of them get 401. Empty only in development.
  identityKeys: string[];
};

type Env = Record<string, string | undefined>;

// Restate's v1 request identity key: the prefix and a base58 Ed25519 key.
const PUBLIC_KEY = /^publickeyv1_[1-9A-HJ-NP-Za-km-z]{40,50}$/;

// The endpoint's settings, or why it must not start.
export function restateEndpointConfig(
  env: Env = process.env,
): RestateEndpointConfig | { disabled: string } {
  if (env.RESTATE_ENDPOINT !== "1") return { disabled: "off" };
  const production = env.NODE_ENV === "production";
  const port = Number(env.RESTATE_ENDPOINT_PORT || 9080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { disabled: "invalid_port" };
  if (port === Number(env.PORT || 3000)) return { disabled: "port_in_use" };
  const identityKeys = (env.RESTATE_IDENTITY_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (identityKeys.some((key) => !PUBLIC_KEY.test(key)))
    return { disabled: "invalid_identity_key" };
  // In production anyone on the private network could otherwise call it.
  if (production && !identityKeys.length)
    return { disabled: "missing_identity_keys" };
  // Railway's private network is IPv6 (and IPv4 in newer environments);
  // "::" takes both. Locally, stay on this machine: Docker's
  // host.docker.internal reaches the Mac's loopback.
  const host = env.RESTATE_ENDPOINT_HOST || (production ? "::" : "127.0.0.1");
  return { port, host, identityKeys };
}
