# Coach dynamic skills — 27 September 2026

Coach sent every turn its whole instructions and every tool: about 29,000 input tokens per model call. Most turns (logging, questions about today) use a fraction of that. Now the instructions and tools that only some turns need are **skills**, loaded when a turn needs them ([lib/agent/skills.ts](../lib/agent/skills.ts)).

## How it works

- **The skills:** photos, routes, web, programmes, lifting, review, goals and memory. Each has its prompt paragraphs, tools and `prepare_change` fields.
- **What every turn gets:** the core instructions, the core tools, and one paragraph listing the skills with their tools.
- **How a skill loads:**
  - **Up front** from a clear signal in the message, in English or Danish ("route", "rutine", "husk", "kaloriemål", …), or when photos are attached. Its instructions arrive in a system message after the date.
  - **By the model**, with `load_skills`. The instructions come back as the tool result, and the tools and fields are offered from the next step.
  - **Automatically**, when the model calls a skill's tool directly.
- **Caching:** core tools come first, so turns with different skills still share the longest cached prefix. The core prompt is the same for every turn and athlete.
- **Validation:** the server still checks every action against the full schema.
- **Policy text is unchanged:** `fullPrompt()` is the whole reviewed policy, and the prompt hash test covers it. A test checks that the core plus the skills is exactly that text, with each skill paragraph matched once.
- **Metrics:** turn metrics record which skills a turn loaded, so production shows how often each is needed.

## Measured

Hard Coach benchmark (`scripts/coach-bench`), 31 scenarios including 5 new skill scenarios, English and Danish, 2 repeats, Luna:

| | Full context (`main`) | Skills |
| --- | --- | --- |
| Passed (excluding one uninformative scenario) | 119/120 | 118/120 |
| Input tokens per model call | 29,000 | 22,100 (−24 %) |
| Median time per turn | 8.3 s | 7.8 s |

- **The excluded scenario** asked Coach to compare two weeks of training. Each context answered correctly with a different tool, so its content check couldn't tell them apart.
- **Two skill flows needed a fix first.** With the goals skill loaded, "set my calorie target to 2400" turned into goal questions ("how old are you?"). The goals paragraph now says a stated target is set as given (reviewed hash change). A clarifying question about an ambiguous exercise, such as Danish "skulderpres", now counts as a pass.
- **After the fix,** the four skill scenarios ran 3 times each in both languages and passed 24/24.

Cost per turn was the same in these dense runs, where nearly everything is read from cache. In production, a turn more than 30 minutes after the last one misses the cache, and a smaller context then costs proportionally less, about 24 % per model call.

## Limits

- **Signals:** a skill whose signal words are missing depends on the model loading it. In the benchmark it did, or it answered correctly with core tools.
- **Coverage:** only Luna; the photos and web search skills aren't in the benchmark yet.
