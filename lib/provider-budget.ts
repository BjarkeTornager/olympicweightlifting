import { budgetState, type BudgetState } from "./tracking-status";
import { providerConfig } from "./agent/provider";
let cached:
  { key: string; expires: number; value: Promise<BudgetState> } | undefined;
// The last state read for a key, kept while a newer one is fetched.
let settled: { key: string; value: BudgetState } | undefined;

function read(): { key?: string; value: Promise<BudgetState> } {
  let config: ReturnType<typeof providerConfig>;
  try {
    config = providerConfig();
  } catch {
    return { value: Promise.resolve("unknown") };
  }
  if (!config) return { value: Promise.resolve("unconfigured") };
  if (config.kind !== "openrouter")
    return { value: Promise.resolve("unknown") };
  const key = config.key!;
  if (cached?.key === key && cached.expires > Date.now()) return cached;
  const value = (async () => {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok) return "unknown" as const;
      return budgetState((await response.json()).data);
    } catch {
      return "unknown" as const;
    }
  })();
  void value.then((state) => {
    settled = { key, value: state };
  });
  cached = { key, expires: Date.now() + 300000, value };
  return cached;
}

// Read-only quota metadata, once per five minutes per server process. No model
// requests, account contents, raw provider responses or secret values are logged.
export async function providerBudget(): Promise<BudgetState> {
  return read().value;
}

// The same, without holding up the request that asks, such as a Coach turn:
// the last state read, while a newer one is fetched in the background once
// it is five minutes old. Before the first read for the key has finished,
// whatever arrives within waitMs, or unknown.
export async function providerBudgetSoon(waitMs = 250): Promise<BudgetState> {
  const { key, value } = read();
  if (key !== undefined && settled?.key === key) return settled.value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      value,
      new Promise<BudgetState>((resolve) => {
        timer = setTimeout(() => resolve("unknown"), waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
