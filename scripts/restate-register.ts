// Registers the app's Restate endpoint with the Restate server
// (docs/restate-setup.md). Run it by hand after the first deploy with
// RESTATE_ENDPOINT=1, and after any deploy that adds, removes or changes a
// service or handler, or upgrades the SDK:
//
//   locally:  node --import tsx scripts/restate-register.ts [--dry-run] [--ping]
//   Railway:  railway ssh --service lift-journal -- env RESTATE_ADMIN_URL=...
//             node /app/restate-register.cjs [--dry-run] [--ping]
//             (the full command is in the doc)
//
// --dry-run shows what would change and changes nothing; --ping calls Ping
// through Restate's ingress afterwards. RESTATE_ADMIN_URL, RESTATE_INGRESS_URL
// and RESTATE_DEPLOYMENT_URL say where things are; the defaults are local.
//
// One stable address is registered, never with force. Restate answers a
// second registration of the same address with the old services, so a change
// is applied by updating that deployment in place, and only while none of
// its services has an invocation that hasn't completed: an invocation that
// started on the old handlers must not be resumed by changed ones.

type Handler = { name: string; ty?: string; [setting: string]: unknown };
type Service = {
  name: string;
  ty: string;
  handlers: Handler[];
  [setting: string]: unknown;
};
type Deployment = {
  id: string;
  uri?: string;
  services: Service[];
  sdk_version?: string | null;
  min_protocol_version?: number;
  max_protocol_version?: number;
};

const env = process.env;
const trim = (url: string) => url.replace(/\/+$/, "");
const admin = trim(env.RESTATE_ADMIN_URL || "http://localhost:9070");
const ingress = trim(env.RESTATE_INGRESS_URL || "http://localhost:8080");
const port = env.RESTATE_ENDPOINT_PORT || "9080";
// On Railway this is http://lift-journal.railway.internal:9080.
const endpoint =
  env.RESTATE_DEPLOYMENT_URL ||
  (env.RAILWAY_PRIVATE_DOMAIN
    ? `http://${env.RAILWAY_PRIVATE_DOMAIN}:${port}`
    : `http://host.docker.internal:${port}`);
const dryRun = process.argv.includes("--dry-run");
const ping = process.argv.includes("--ping");

async function call<T>(method: string, path: string, body?: unknown) {
  const response = await fetch(`${admin}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok)
    throw Error(`${method} ${path} answered ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const sameUrl = (a: string, b: string) => new URL(a).href === new URL(b).href;

// The same value with every object's keys in order, so that equal settings
// compare equal whatever order Restate lists them in.
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sorted(item)]),
        )
      : value;

// What registration decides on: a service's type and settings (retention,
// timeouts, retries), and each handler's kind and settings, which override
// the service's.
function summary(service: Service) {
  const settings = JSON.stringify(
    sorted(
      Object.fromEntries(
        Object.entries(service).filter(
          ([key]) => !["deployment_id", "revision", "handlers"].includes(key),
        ),
      ),
    ),
  );
  const handlers = new Map(
    service.handlers
      .map(
        ({ name, ty, ...rest }) =>
          [
            `${name}${ty ? ` (${ty})` : ""}`,
            JSON.stringify(sorted(rest)),
          ] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return { settings, handlers };
}

const handlerList = (service: Service) =>
  [...summary(service).handlers.keys()].join(", ");

export function changes(current: Service[], next: Service[]) {
  const lines: string[] = [];
  const before = new Map(current.map((s) => [s.name, s]));
  const after = new Map(next.map((s) => [s.name, s]));
  for (const [name, service] of after) {
    const old = before.get(name);
    if (!old) {
      lines.push(`+ ${name}: ${handlerList(service)}`);
      continue;
    }
    if (old.ty !== service.ty)
      throw Error(
        `${name} would change from ${old.ty} to ${service.ty}. Never change a service's type in place: give it a new name.`,
      );
    const a = summary(old);
    const b = summary(service);
    for (const [h, settings] of b.handlers) {
      const was = a.handlers.get(h);
      if (was === undefined) lines.push(`+ ${name}.${h}`);
      else if (was !== settings) lines.push(`~ ${name}.${h} settings`);
    }
    for (const h of a.handlers.keys())
      if (!b.handlers.has(h)) lines.push(`- ${name}.${h}`);
    if (a.settings !== b.settings) lines.push(`~ ${name} settings`);
  }
  for (const name of before.keys())
    if (!after.has(name)) lines.push(`- ${name}`);
  return lines;
}

// The SDK's version and the protocol versions it speaks. An SDK upgrade
// changes them, and Restate learns of it only from an update.
export function deploymentChanges(current: Deployment, next: Deployment) {
  return (
    ["sdk_version", "min_protocol_version", "max_protocol_version"] as const
  )
    .filter((key) => (current[key] ?? null) !== (next[key] ?? null))
    .map(
      (key) => `~ ${key}: ${current[key] ?? "none"} to ${next[key] ?? "none"}`,
    );
}

// Invocations of these services that haven't completed: running, waiting,
// suspended, backing off, paused or scheduled. Counts only.
async function unfinished(names: string[]) {
  if (!names.length) return [];
  const list = names.map((n) => `'${n.replaceAll("'", "''")}'`).join(", ");
  const { rows } = await call<{
    rows: { service: string; status: string; n: number }[];
  }>("POST", "/query", {
    query: `SELECT target_service_name AS service, status, COUNT(*) AS n FROM sys_invocation WHERE status <> 'completed' AND target_service_name IN (${list}) GROUP BY target_service_name, status`,
  });
  return rows;
}

const describe = (services: Service[]) =>
  services.map((s) => `${s.name} (${s.ty}): ${handlerList(s)}`).join("; ");

async function register() {
  await call("GET", "/health").catch((error) => {
    throw Error(`Restate's admin API at ${admin} isn't reachable. ${error}`);
  });
  const { deployments } = await call<{ deployments: Deployment[] }>(
    "GET",
    "/deployments",
  );
  const existing = deployments.find((d) => d.uri && sameUrl(d.uri, endpoint));
  if (!existing) {
    const preview = await call<Deployment>("POST", "/deployments", {
      uri: endpoint,
      force: false,
      dry_run: true,
    });
    if (dryRun) {
      console.log(`Would register ${endpoint}: ${describe(preview.services)}`);
      return;
    }
    // force defaults to true in Restate's admin API, so it is sent as false.
    const created = await call<Deployment>("POST", "/deployments", {
      uri: endpoint,
      force: false,
    });
    console.log(
      `Registered ${endpoint} as ${created.id}: ${describe(created.services)}`,
    );
    return;
  }
  const current = await call<Deployment>("GET", `/deployments/${existing.id}`);
  // Discovery through Restate, which signs the request; nothing is saved.
  const next = await call<Deployment>("PATCH", `/deployments/${existing.id}`, {
    uri: endpoint,
    overwrite: true,
    dry_run: true,
  }).catch((error: unknown) => {
    // Restate updates a deployment in place only while the SDK speaks the
    // same protocol versions.
    if (error instanceof Error && error.message.includes("META0016"))
      throw Error(
        `${error.message}\nRestate can't update ${existing.id} in place. Register the endpoint under a new address (docs/restate-setup.md, Runbook).`,
      );
    throw error;
  });
  const diff = [
    ...deploymentChanges(current, next),
    ...changes(current.services, next.services),
  ];
  if (!diff.length) {
    console.log(
      `${endpoint} is registered as ${existing.id} and nothing changed: ${describe(current.services)}`,
    );
    return;
  }
  console.log(`Changes for ${existing.id} at ${endpoint}:\n${diff.join("\n")}`);
  const names = [
    ...new Set([...current.services, ...next.services].map((s) => s.name)),
  ];
  const busy = await unfinished(names);
  if (busy.length)
    throw Error(
      `Not updated: these invocations haven't completed:\n${busy
        .map((r) => `${r.service} ${r.status}: ${r.n}`)
        .join(
          "\n",
        )}\nTry again once they have, or cancel them with the restate CLI.`,
    );
  if (dryRun) {
    console.log("Nothing is running, so it would be updated in place.");
    return;
  }
  await call("PATCH", `/deployments/${existing.id}`, {
    uri: endpoint,
    overwrite: true,
  });
  console.log(`Updated ${existing.id} in place.`);
}

async function pingThroughIngress() {
  const response = await fetch(`${ingress}/Ping/ping`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok)
    throw Error(`Ping through ${ingress} answered ${response.status}: ${text}`);
  console.log(`Ping through ${ingress}: ${text}`);
}

async function main() {
  await register();
  if (ping) await pingThroughIngress();
}

if (process.argv[1] && /restate-register\.(ts|cjs)$/.test(process.argv[1]))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
