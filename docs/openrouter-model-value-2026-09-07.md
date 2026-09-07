# OpenRouter model value assessment — 7 September 2026

Recommendation: benchmark **GPT-5.6 Luna** first as a lower-cost everyday Coach, with **GLM 5.3 Flash** as the more aggressive cost-saving challenger. Keep the current Gemini 3.8 Flash configuration until candidates demonstrate acceptable Coach quality, image accuracy and end-to-end response time. This is a researched shortlist, not evidence that either has beaten Gemini in this app. No paid inference, production model change, account-policy change or user-record access was performed for this assessment.

## Current application

Railway's provider/model names were read selectively: `AGENT_PROVIDER=openrouter`, `AGENT_MODEL=google/gemini-3.8-flash`. The app uses the same provider adapter for Coach and automatic image classification. Requests enforce tool-parameter support, `data_collection: deny` and `zdr: true`.

The implementation allows five model rounds per Coach turn, with a 90-second overall deadline. It includes up to eight completed conversation turns, plus bounded journal/tool results. The fixed prompt was 19,951 characters and the 16 tool definitions 20,590 characters at source `69cfe4d`. These are character counts, not measured token counts; conversation and retrieved data add more. A question can therefore generate several billable model calls. The production stream adapter currently discards usage frames rather than retaining per-turn cost/cache metrics.

## Prices and eligible routes

Prices were retrieved from the public [model catalogue](https://openrouter.ai/api/v1/models), [zero-retention endpoint list](https://openrouter.ai/api/v1/endpoints/zdr), and each model's endpoint API. Routes below were listed with status 0, tool support and in the ZDR endpoint list at lookup time. This checks public eligibility; it is not a live completion test with the production key. ZDR does not by itself guarantee EU residency for the complete service. [OpenRouter ZDR documentation](https://openrouter.ai/docs/guides/features/zdr).

All amounts are USD. The illustrative cost is for **1,000 model calls, each with 10,000 uncached input tokens and 1,000 total billable output tokens**, without image-specific charges, cache writes or credit-purchase fees. It is not a forecast of 1,000 user messages. Actual reasoning-token use, cache hits, retries and call count change the result.

| Model / selected route | Input / 1M | Output / 1M | Illustrative 1,000 calls | Saving vs current |
| --- | ---: | ---: | ---: | ---: |
| Gemini 3.8 Flash · `google-vertex/global` | $0.75 | $3.75 | $11.25 | 0% |
| GPT-5.6 Luna · `azure/eu` | $0.22 | $1.32 | $3.52 | 69% |
| GLM 5.3 Flash · `fireworks / together / baseten/fp8` | $0.15 | $0.50 | $2.00 | 82% |
| Gemini 3.5 Flash Lite · `google-vertex/global` | $0.30 | $2.50 | $5.50 | 51% |
| Mistral Small 4 · `mistral/zdr` | $0.15 | $0.60 | $2.10 | 81% |

- **Gemini 3.8 Flash:** $0.75/$3.75 is the standard eligible Vertex price observed today, already reflecting the currently displayed discount. The cheaper Flex route was not active in the endpoint snapshot. The app does not pin a price or provider, so this is a comparison baseline, not proof of the rate paid for every historic call. [Model prices](https://openrouter.ai/google/gemini-3.8-flash).
- **GPT-5.6 Luna:** advertised base rates are $0.20/$1.20. The available ZDR route in this snapshot was Azure EU at $0.22/$1.32; global/US Azure routes had status -5. Image input, streaming, functions and structured output are supported. OpenAI describes it as a cost-sensitive model roughly corresponding to the earlier nano tier, so treat it as a candidate rather than an automatic quality upgrade. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [OpenRouter endpoint prices](https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints).
- **GLM 5.3 Flash:** use $0.15/$0.50 on eligible standard routes for planning. Some routes are currently $0.075/$0.25, and Relace lists $0.07125/$0.2375. The Z.ai 50% promotion ends on 9 September at 16:00 UTC; do not base a lasting decision on it. Eligible routes differ in quantization, uptime and parameter support. [Model and provider prices](https://openrouter.ai/z-ai/glm-5.3-flash).
- **Gemini 3.5 Flash Lite:** a straightforward Google-family option for focused classification/extraction, though cheaper does not establish adequate quality for the entire Coach conversation. [Model capabilities and prices](https://openrouter.ai/google/gemini-3.5-flash-lite).
- **Mistral Small 4:** another inexpensive multimodal/tool candidate. A first-party ZDR route lists $0.15/$0.60 and an EU route $0.165/$0.66. It is a secondary candidate for simple tasks rather than my first full-Coach choice. [Model and provider prices](https://openrouter.ai/mistralai/mistral-small-2603).

## Quality and experience

GPT-5.6 Luna is designed for cost-sensitive chat and lightweight agent work. Artificial Analysis shows substantial variation across reasoning efforts: its current release page lists Intelligence Index v4.2 results from 19 without reasoning to 43 at max. A high-effort benchmark score should not be treated as the quality of a short, low-effort Coach response. Its documented throughput is promising, but first-party benchmarks do not measure our eligible Azure route or a complete tool loop. [Artificial Analysis Luna release comparison](https://artificialanalysis.ai/models/releases/gpt-5-6-luna).

GLM is especially interesting because its independent reasoning/agent results are competitive at low token prices. Artificial Analysis also describes it as slow and very verbose. Those characteristics matter for the user's phone experience and the app's output/time limits. A lower per-token rate can still produce a longer or more expensive successful task if it uses much more reasoning or retries. [Artificial Analysis GLM assessment](https://artificialanalysis.ai/models/glm-5-3-flash).

None of these published benchmarks establishes correct ingredient evidence, reading a sleep screenshot, avoiding invented measurements or giving helpful, non-intrusive health coaching. The prior GEPA experiment tested prompt revisions on Gemini, not cross-model or multimodal quality.

## Practical next evaluation

Use the current prompt and synthetic accounts to compare Gemini, Luna and GLM on the same text and image cases: gym logging with per-dumbbell ambiguity, exact sleep times, food ingredients with uncertain visual evidence, retrieving the right meal photos, cardio unit conversions, grounded suggestions, tables and corrections. Run repeated cases; measure valid reviewed proposals, fabricated facts, completion failures, end-to-end latency and **cost per successful user task**. Preserve server ownership checks, explicit save reviews and all privacy routing requirements. Do not use actual user journals or images as benchmark data.

Reasoning tokens are billed as output tokens. The current adapter does not set reasoning effort, so a model switch must test both default behavior and any proposed effort setting against the 1,800/3,200-output-token and 90-second limits. Hiding reasoning is not a cost control. [OpenRouter reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Also capture aggregate server-side `usage.cost`, prompt/completion/reasoning tokens, cached tokens, latency and tool rounds without logging health content. Gemini already supports implicit caching; measure the hit rate before claiming an extra cache saving. In-memory prompt caching and full response caching have different retention behavior; account-level ZDR disables OpenRouter response caching. [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [response caching](https://openrouter.ai/docs/guides/features/response-caching).

Qwen3.7 Flash, Qwen3.8 Flash and Meta's Muse Spark 1.3 Contributor had no entries in the public ZDR list at lookup time, so their attractive headline prices were excluded from the recommendation. The absence is time-specific, not a claim that those model families can never meet the policy.

## Migration follow-up on 7 September

Real Luna requests exposed a compatibility detail the catalogue assessment missed: the Azure routes require `max_completion_tokens`, while the existing adapter sends `max_tokens`. With required-parameter routing, this incorrectly excluded the ZDR Azure routes and produced a privacy-policy routing error. Switching the token-limit parameter restored eligible requests without relaxing privacy. Explicit `strict: false` on Luna tools also preserves the app's optional fields; server validation remains mandatory. See the [OpenRouter completion API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) and [OpenAI function-calling strict-mode behavior](https://developers.openai.com/api/docs/guides/function-calling).
