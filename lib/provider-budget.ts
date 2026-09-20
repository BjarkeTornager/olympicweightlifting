import { budgetState, type BudgetState } from "./tracking-status";
import { providerConfig } from "./agent/provider";
let cached:
  { key: string; expires: number; value: Promise<BudgetState> } | undefined;

// Read-only quota metadata, once per five minutes per server process. No model
// requests, account contents, raw provider responses or secret values are logged.
export async function providerBudget(): Promise<BudgetState> {
  let config: ReturnType<typeof providerConfig>;
  try {
    config = providerConfig();
  } catch {
    return "unknown";
  }
  if (!config) return "unconfigured";
  if (config.kind !== "openrouter") return "unknown";
  if (cached?.key === config.key && cached.expires > Date.now())
    return cached.value;
  const value = (async () => {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${config.key}` },
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
  cached = { key: config.key!, expires: Date.now() + 300000, value };
  return value;
}
