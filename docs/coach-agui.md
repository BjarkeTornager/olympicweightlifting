# Coach chat with AG-UI

Coach uses the official AG-UI core, client and encoder SDKs with the existing Railway service and configured model provider. No separate agent host or browser API key is needed.

## Experience

Replies arrive as the provider generates text. Short activity labels identify journal retrieval, visual creation and proposal preparation. Stop cancels the connection and leaves the question ready to edit or resend. Deliberate reading pauses automatic scrolling; the existing mobile keyboard and latest-exchange behavior is preserved.

Coach can display comparison tables, bar charts and connected diagrams. Ask “Show my week in a table”, “Chart my logged sleep this week”, or “Explain my warm-up as a diagram”. Markdown comparison tables also render as tables. Wide tables scroll within the answer; diagrams have a readable list of connections with complete labels. Visuals return with the owner's saved conversation.

The default is one useful visual and a short explanation. A turn permits at most three visuals: six columns and 30 rows per table, 30 chart points, or 12 diagram nodes and 18 connections. Journal changes still require a completed review card and an explicit Save. Visuals cannot execute actions. Interrupted answers are marked incomplete and cannot confirm saves.

## Contract and privacy

`GET /api/agent` advertises `protocol: "ag-ui"`. The browser loads `HttpAgent` on demand and sends `POST /api/agent/run` with standard `RunAgentInput`: one user message, empty state/tools/context, and bounded `forwardedProps` containing revision, timezone and owned image IDs. The old JSON POST remains for rolling releases; a failed stream is never retried automatically through it.

The endpoint verifies the session, account header and origin before opening a stream. `threadId` is a correlation value, never an account selector. The server loads the authenticated owner's history and journal tools. Forged system messages, tool definitions, client state, extra context and identity fields are rejected.

Events include `RUN_STARTED`, `STEP_STARTED` / `STEP_FINISHED`, `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END`, validated `CUSTOM` events named `coach.visual`, and `RUN_FINISHED` with the durable reply, visuals and review cards. `RUN_ERROR` contains sanitized user-facing text. Activity labels disclose no tool arguments or complete journal snapshots. Reasoning and raw provider errors are not forwarded. SSE responses are private, no-store and unbuffered, with periodic keep-alives.

OpenRouter SSE and Ollama NDJSON adapters validate fragmented text/tool calls, size limits and terminal markers. Truncation fails rather than executing an incomplete tool call. Cancellation reaches the provider request and is checked before preparing a proposal or persisting completion. Upstream processing/billing may continue when a provider does not support cancellation.

The `show_visual` tool uses a plain object schema compatible with provider tool APIs. A stricter discriminated union validates each selected visual before emission and persistence. The browser validates streamed and historical visuals again. React renders controlled elements and text only: no model HTML, SVG source, JavaScript, external images, arbitrary styles or event handlers. No additional CSP permissions are needed.

Visuals use the existing private `agent_turns.response` JSON column and conversation retention/deletion rules. No SQL migration or public asset storage is introduced. Database operations retain owner predicates. OpenRouter's existing zero-data-retention and no-data-collection routing constraints remain enabled.

## Verification

`npm run check:production`, `npm run build` and `npm run test:browser` cover schema rejection, provider framing, the actual AG-UI SDK, private history/replay, account isolation, cancellation, safe rendering, accessible mobile visuals and explicit Save. Browser fixtures use synthetic identities and streams, with no production writes.

The opt-in real-model check creates and deletes a synthetic account in a disposable `_test` database. It checks all three visual kinds, exact chart values, live text events, persisted visuals and an unchanged journal revision:

```sh
AGENT_PROVIDER=openrouter AGENT_MODEL=google/gemini-3.8-flash node --import tsx scripts/coach-visuals-smoke.ts
```

`node scripts/check-public-access.mjs` also verifies that the streaming endpoint denies anonymous and foreign-origin requests before opening an event stream.

## References

- [AG-UI HttpAgent](https://docs.ag-ui.com/sdk/js/client/http-agent), [subscriber lifecycle](https://docs.ag-ui.com/sdk/js/client/subscriber), and [events](https://docs.ag-ui.com/sdk/js/core/events)
- [OpenRouter streaming and cancellation](https://openrouter.ai/docs/api_reference/streaming)
- [Ollama streaming](https://docs.ollama.com/capabilities/streaming)
