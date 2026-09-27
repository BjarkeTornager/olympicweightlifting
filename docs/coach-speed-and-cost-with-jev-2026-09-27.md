# Faster, cheaper Coach replies and logging, with Jev — 27 September 2026

**Status, 27 September:** measurement shipped in #30 (`npm run coach:metrics`), and step 1 in #31. Step 1 needed a cache breakpoint as well as moving the date: on six test turns, routine Luna turns went from about $0.009 to $0.002 each once the cache was warm. A GEPA run on the logging rules ([report](gepa-logging-rules-2026-09-27.md)) found no better wording and confirmed that step 4 is the way to cut the extra read round. Step 4 then shipped for today's check-ins, activities and new meals. On the workflow benchmark (60 conversations each), one-fact logs went from two model calls to one; overall, rounds per turn fell from 1.88 to 1.44, cost per turn by 22% and median time per turn from 7.3 to 5.3 seconds, while passes rose from 57 to 60.

A proposal, not a change. It builds on the [Jev assessment](jev-assessment-2026-09-19.md), the [classifier benchmark](jev-benchmark-2026-09-19.md) and the [workflow benchmark](jev-workflow-benchmark-2026-09-19.md), and on today's code.

## Where the time and money go today

- **Every model round sends about 33,000 tokens before the conversation starts:** 83,600 characters of tool definitions (about 21,000 tokens) and a 48,900-character system prompt (about 12,000 tokens). Measured from `toolDefinitions` and `systemPrompt()` on main (7f89a37).
- **A turn usually takes two rounds**: the workflow benchmark made 152 model requests for 76 turns. A typical log is "read the day, then save", and the read-before-write rules add the round.
- **Turns took 9.2 s median and 36.6 s at p95** in that benchmark (synthetic, Luna tier).
- **The fixed prefix changes every minute.** `systemPrompt` puts the date at character 544 and the time at 582. Providers cache only an identical prefix, so almost none of the 12,000-token prompt can be reused between turns.
- **Jev already routes each turn** (`lib/agent/routing.ts`) to Luna, Terra or Astra. It costs about 300 ms and $0.00004 per decision ($0.042 per million input tokens, output free; `jev-1.13.0` is still the only version).

## What to do, in order

### 1. Make the fixed prompt cacheable (no Jev needed; biggest and safest win)

Move the date, time and part of the day out of the top of the system prompt into the "Everything recorded today" message, and keep the tool list in a fixed order. The 33,000-token prefix then stays byte-identical across turns and athletes, so the provider's prompt cache can reuse it. OpenAI-family models bill cached input at a fraction of the normal rate and start answering sooner. This is a reviewed prompt change: the hash test's note has to say only the position of the date moved.

Measure before and after: record the provider-reported cached-token count per request (metadata only).

### 2. Instant logging for simple single facts (Jev plus exact parsing)

For a message that states one fact, such as "drank 500 ml water", "slept 7 h 20", "weight 87.6", "body fat 14 %" or "had my usual breakfast", skip the generative model:

1. **Jev (one request, about 300 ms)** answers:
   - `kind` (choice): drink, sleep, bodyweight, body fat, usual meal, or other;
   - `single_own_report` (yes/no): the athlete reports something they did or measured, not a plan, question, negation or someone else;
   - `another_request` (yes/no): the message asks for anything else.
2. **Code parses the number** with strict patterns (ml/L, h/min, kg, %), in English and Danish.
3. **Only if both agree** (kind probability ≥ 0.95, single report ≥ 0.9, another request ≤ 0.1, and the parse succeeds) does the server save through the existing `prepareAction` path, with the usual receipt and Undo. It replies with a short fixed text, for example "Logged 500 ml water. 1.5 L of about 2.5 L today."
4. **Everything else goes to Coach as now.**

Expected: under a second instead of about 9, and about $0.00004 instead of a full Coach turn. Jev never writes anything itself; the existing validation and ownership rules still decide. The benchmark supports this narrow use: no held-out false "personal event" decisions at ≥ 0.85, but errors on negation and third-party reports below that, which the separate questions and strict thresholds guard against.

Before shipping: add fast-path fixtures (English and Danish, negations, other people, mixed requests, "I didn't…", and plans) to `scripts/jev`, and require zero false saves on the held-out split. Ship behind a flag, starting with drinks and body measurements.

Privacy: this sends the same data Jev routing already receives (the latest message), which the consent screen already discloses.

### 3. A smaller tool set and prompt for routine turns (Jev-guided)

When Jev is confident a turn is a plain log or question (work kind ≥ 0.9, mixed or unclear low), offer only the relevant tools, for example the logging tools and the day's read tools. Also leave out the prompt sections that don't apply: programme design, route planning, video review and image library. That could cut the fixed prefix from about 33,000 tokens to about 12,000 per round.

Safety valve: if the model asks for a tool it wasn't given, or says it can't do something, repeat the round with the full tool set. The benchmark showed a mixed Danish request ("log soup and design next week's programme") classified as a plain report at 0.85, so the threshold must stay high and the fallback automatic.

Validate with the workflow benchmark (`npm run benchmark:jev:workflows -- --live`). It must match the current baseline of 65/76 turns fully correct, with no new failures.

### 4. Fewer rounds by supplying the reads up front

The day's records are already in the context, yet the rules still require a `cardio_journal` or `food_journal` read before some saves. When Jev has classified the domain and the date is today, the server can attach that read's result to the first request and mark it as read. That saves a whole round, about 3–4 seconds, for most logs.

### 5. Jev as a cheap quality check, so more turns can use the cheapest model

After a turn, Jev can check the reply for a false "saved" claim, a missed second request or a wrong journal change. In the workflow benchmark it caught 7 of 9 real problems, with 0 false alarms in 64 clean turns, at about 300 ms. Start by only logging its flags for review. Later, re-run flagged turns on the next tier up, so routine turns can safely stay on Luna or a faster model.

Privacy: this sends the reply and the relevant journal facts to TypeSafe, which is more than routing does. Before turning it on, confirm TypeSafe's retention terms for this account and update the privacy policy and consent text, as the 19 September assessment noted.

## Suggested sequence

1. **Measure:** per turn, record rounds, input, cached and output tokens, latency and tier (metadata only, no message text), to get a real production baseline.
2. **Ship step 1** (cacheable prompt) and compare cost and time to first reply.
3. **Build step 2** (instant logging) behind a flag with its benchmark, then enable it for drinks and body measurements.
4. **Try steps 3 and 4 together** on the workflow benchmark; enable only if quality holds.
5. **Run step 5 observe-only**, then decide on automatic escalation.

Step 5 depends on a data-handling review. None of the steps changes what Coach is allowed to save, or its review, Undo and ownership rules.
