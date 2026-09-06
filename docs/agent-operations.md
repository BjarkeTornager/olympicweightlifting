# Training assistant operations

Lift Journal's default screen is Coach. The model runs behind authenticated server routes; the browser never receives provider keys. Both OpenRouter and Ollama adapters use the same validated training tools.

## Hosted provider

The owner selected **OpenRouter**, with a **$5 monthly API-key usage cap** and no automatic top-up. A dedicated `Lift Journal production` key is provisioned in Railway. The initially generated, unused default key was revoked. Model choice is configuration, not client input.

- `AGENT_PROVIDER=openrouter`
- `AGENT_MODEL=google/gemini-3.8-flash` (verified in OpenRouter's tool-capable catalogue on 6 September 2026; evaluate with the synthetic smoke test before changing)
- `OPENROUTER_API_KEY` is a Railway secret; never add it to a `NEXT_PUBLIC_*` variable or Git.
- Requests require tool-parameter support, `data_collection: "deny"`, and `zdr: true`. An unavailable eligible provider causes a visible failure; privacy filters are never relaxed as a fallback.
- Account controls also disallow training/publication and enforce ZDR. This is not an EU-residency guarantee. Do not enable prompt logging, the data discount, or general web/search plugins for this private journal.
- The key cap limits model usage, not credit-purchase taxes/fees. OpenRouter needs prepaid credit. Account billing and the site's Railway hosting costs are separate. The owner added $10 on 6 September 2026; this does not raise the $5 monthly cap.
- Configuration changes must be represented with `preserve()` in `.railway/railway.ts`; review `railway config plan` before applying anything.

The provider supports tool calling through its normal chat API. No model has direct SQL, filesystem, shell, generic HTTP, account switching, email, or third-party messaging access. Tools retrieve only the authenticated account's journal and the site's catalogue/help. Site help lives in `lib/agent/knowledge.ts` and must be updated with product changes.

## Changes, retries and recovery

Agent messages are saved in `agent_turns`. `agent_proposals` holds a 24-hour snapshot of a proposed change, its owner, original revision and stable save/undo IDs. Preparation never saves training. The confirmation button performs a normal journal transaction, with proposal status and conversation update in the same database transaction. A later journal revision blocks a stale proposal or undo. Repeated identical confirmations are idempotent. Existing drafts and imported history remain intact on provider or network failures.

Completed sessions need exact dates, weights and whole reps; accessory training retains its category. Repeated routines start unlogged. Programme targets come from the existing deterministic progression engine. Agent-created historical sessions do not invent start/finish times. Personal-best settings require a separate explicit edit.

A conversation stores up to 40 visible turns; the model receives the last four completed turns plus bounded tool results. Each request allows at most five model rounds, ten tool calls and one proposed change, with a 90-second overall deadline and per-account request limits. Conversation older than 90 days and expired proposals are purged on subsequent assistant use. Clear conversation deletes messages and proposals immediately without deleting training. Journal exports do not include chat.

## Verification

`npm run check:production`, `npm run build`, and `npm run test:browser` cover the journal and agent review flow. Agent database tests use `TEST_DATABASE_URL` and verify ownership, retry idempotency, stale proposals and undo, provider failure, and read isolation.

Run a real provider smoke test against **synthetic accounts in the disposable test database**:

```sh
AGENT_PROVIDER=openrouter AGENT_MODEL=google/gemini-3.8-flash node --import tsx scripts/agent-smoke.ts
```

The opt-in script reads the key from the private operator configuration if absent from the environment. It prepares a known accessory workout, verifies no write before confirmation, saves, retrieves the exact history and undoes it, then deletes the synthetic account. Never set `TEST_DATABASE_URL` to production. Production verification should read the real account only; do not add test workouts to it.

## Local alternative

Use `AGENT_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434/api`, and a tool-capable `OLLAMA_MODEL`. An optional `OLLAMA_API_KEY` is server-only. For Ollama Cloud the base is `https://ollama.com/api`. The URL is administrator configuration and cannot come from chat.

A Railway service cannot reach the Mac's localhost. Do not expose an unauthenticated Ollama port to the internet. The 30B local Qwen model timed out on this Mac during verification; it is not the live provider.
