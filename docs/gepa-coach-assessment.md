# GEPA assessment for Coach

Research date: 7 September 2026. Based on the Coach implementation subsequently published in the [7 September release](coach-design-deployment-2026-09-07.md), including the coaching, photo and ingredient changes. This is an assessment and proposed experiment; GEPA has not been installed, run or deployed, and no user conversations or photos were sent to an optimizer.

## Recommendation

**Use GEPA for a bounded offline prompt experiment after building a repeatable Coach evaluation set.** The strongest initial targets are thoughtful conversational behavior and reliable journal retrieval. Food ingredient extraction and screenshot handling are useful subsequent targets, once the text pilot demonstrates improvement.

GEPA proposes prompt revisions by reflecting on execution results and explanatory feedback, then evaluates competing candidates. The original paper reports improvements on its benchmarks; it does not establish that our health Coach will improve. We need an app-specific comparison. [GEPA paper](https://arxiv.org/abs/2507.19457).

The recommended deliverable is a versioned prompt change with before/after examples and test results. Railway would serve that selected prompt through the existing Coach. Optimization runs separately during development; no new production service or cron job is needed for this pilot.

## Fit with the current app

| Current implementation | What this means for GEPA |
| --- | --- |
| [`lib/agent/knowledge.ts`](../lib/agent/knowledge.ts) combines conversational guidance, food/sleep/cardio rules, tool instructions and safety requirements in one system prompt. | Separate a small editable coaching section from fixed rules before optimization. Establish that the initial extraction preserves existing behavior. |
| [`runTurn`](../lib/agent/engine.ts) accepts an injected model function and supports multiple model/tool rounds. | An evaluation wrapper can run the actual engine and capture requests, tool results, failures, proposals and replies. A single-turn question/answer benchmark would miss important behavior. |
| [`scripts/coaching-smoke.ts`](../scripts/coaching-smoke.ts) exercises advice, refusal of suggestions and the on-request preference with a synthetic account. | Useful seed scenarios, but its automated assertions mainly check retrieval, proposal count and journal revision. It prints replies for review; it does not yet score conversational quality. |
| Nutrition, sleep, cardio, photo and visual smoke scripts already exist. | Reuse their fixture patterns and expected structured results in a repeatable evaluation harness. |
| [`lib/coaching.ts`](../lib/coaching.ts) computes the opening suggestion; the engine supplies a fixed reply when a proposal is prepared. | GEPA cannot improve these app-generated strings by changing the model prompt. Keep those out of the model tone score. |
| [`lib/agent/food-tags.ts`](../lib/agent/food-tags.ts), action validation and account-scoped database access enforce rules in code. | These remain independently tested constraints. Prompt optimization can reduce rejected tool calls, but must not replace validation, isolation or review-before-save. |
| The provider adapter returns normalized messages without exposing billing usage in that result. | Cost measurement needs an evaluation-only accounting hook; the number of evaluations alone is insufficient. |

Our small number of testers makes deliberate synthetic examples and direct review more useful initially than production A/B statistics. GEPA should improve the shared Coach behavior; individual preferences continue to come from each user's private profile and journal.

## Integration approach

Use the official Python GEPA package with an evaluator that invokes a fixed Node/TypeScript runner over JSON input/output. The runner executes `runTurn` in a disposable test account. This preserves the existing engine, tools and provider configuration. Candidate prompts are data passed to the runner, never shell commands or generated executable code.

Start with `optimize_anything` in its dataset/generalization mode. Its evaluator can return a score and structured diagnostic feedback, and supports separate training and validation data. A custom `GEPAAdapter` is an option if we later need more control over traces or batching. [Optimization API](https://gepa-ai.github.io/gepa/api/optimize_anything/optimize_anything/), [adapter guide](https://gepa-ai.github.io/gepa/guides/adapters/).

DSPy includes GEPA and is recommended by the project for Python AI pipelines. Our application is an existing TypeScript agent, so my recommendation is to keep its execution path and add the small evaluation bridge. There is no demonstrated benefit yet from migrating the Coach to DSPy. [GEPA quick start](https://gepa-ai.github.io/gepa/guides/quickstart/).

Pin the package version and dependencies when implementing. The current API reference describes `OptimizeAnythingConfig`, while some official examples still use `GEPAConfig`; validate the chosen version with a tiny local contract test before starting paid evaluations. [API reference](https://gepa-ai.github.io/gepa/api/optimize_anything/optimize_anything/).

The first candidate should contain only conversational instructions. A later experiment can optimize the wording of retrieval guidance while retaining fixed tool schemas, names, permissions, ingredient evidence rules and date/unit semantics. Do not let the optimizer change its own scoring rubric or weaken a failing test.

## Evaluation scenarios

Start with roughly 60 short synthetic scenarios: 20 for optimization, 20 for candidate selection and 20 reserved for a final comparison. This is a proposed pilot size, not evidence that 60 cases are sufficient for release. Group by underlying scenario and source fixture; paraphrases of the same conversation or versions of the same image belong in one split. Cover each major behavior with distinct fixtures across splits. Begin with text and journal-retrieval scenarios while retaining existing image checks as regression tests; expand the labeled image corpus before optimizing multimodal instructions. The table below describes the combined evaluation scope.

| Scenario | What a good result demonstrates |
| --- | --- |
| Low energy, a busy evening and a saved family-life focus | Reads relevant records and offers one useful optional step suited to the stated constraint. |
| The user declines a walk and further tracking | Accepts the decision without another task or repeated suggestion. |
| A greeting with “advice only when I ask” enabled | Responds naturally without initiating a health checklist. |
| “What did I have for dinner yesterday?” | Retrieves the correct dates and meal type, answers from saved food and discloses incomplete records. |
| “Show photos of today's meals” | Uses linked meal photos and the gallery tool, preserves category boundaries and avoids unnecessary image analysis. |
| A food description with oil included and butter excluded | Tags each reported ingredient, respects exclusions and retains uncertainty separately. |
| A label with ingredients and a “may contain” warning | Reads actual ingredients, distinguishes evidence and does not promote the warning into a consumed ingredient. |
| Sleep screenshots with time asleep and time in bed | Distinguishes the values and dates; only prepares a check-in when logging is requested. |
| Running or cycling reports and corrections | Uses correct units, checks the existing record and preserves unrelated fields. |
| A requested table or diagram | Produces a valid visual with grounded values and an appropriately short explanation. |

Include missing data, ambiguous dates, deleted photos, untagged older food and conflicting image metadata. Use conversation episodes for follow-ups, with fresh accounts between candidates and the intended state preserved within an episode. Freeze dates, timezone and seeded history. Evaluate the selected model with the production tool limits: at most five model rounds, ten tool calls and the current timeout. Keep streaming checks in the final regression pass as well as ordinary engine evaluations.

## Scoring and promotion

Use two layers:

1. **Required correctness checks:** account ownership, correct dates/units, source-grounded measurements and ingredients, appropriate tools, valid proposals, no unrequested logging proposal and no journal change before confirmation. A failed requirement gives a scenario a failing score and blocks promotion if it persists in the release checks. Record attempted invalid calls as well as final output so an eventual server rejection cannot hide poor behavior.
2. **Conversation quality:** score relevance, respect for the person's constraints, natural wording and appropriate concision. Reward a useful answer when advice is appropriate and a simple acknowledgement when it is not. Do not optimize for message length or the number of suggestions alone. Use a fixed judge rubric calibrated against human-reviewed examples, then review a blinded, randomized comparison of baseline and candidate replies.

Give GEPA specific feedback such as: “The person declined a walk, but the reply suggested walking again,” or “The dinner lookup used the right date but omitted the dinner filter.” Do not rely on a generic “be more helpful” score. The adapter documentation emphasizes diagnostic feedback from execution. [Adapter guide](https://gepa-ai.github.io/gepa/guides/adapters/).

Keep final test cases outside optimization and judge calibration. Compare the unchanged baseline and chosen candidate repeatedly on those cases, report per-scenario outcomes and variation, and retain the baseline when improvements are unclear. Count ties explicitly in human preferences. A higher average must not compensate for a new privacy, logging or evidence failure. A perfect result on this finite suite is evidence for that suite, not a guarantee for all future inputs.

Version the candidate prompt, fixed policy hash, dataset version, model/provider settings, judge rubric, random seed and results together. Re-evaluate when the model or toolset changes. Review the actual prompt diff for copied examples and factual drift; deploy an accepted version through the normal release process with the previous prompt available for rollback. GEPA's FAQ documents both example overfitting and changes to task definitions as failure modes. [GEPA FAQ](https://gepa-ai.github.io/gepa/guides/faq/).

## Privacy, cost and scope

Use synthetic journals and generated test images first. The evaluator and reflection model may receive tool traces; do not export production accounts, conversations, photos, credentials or database URLs. Existing consent to use Coach is not consent to repurpose personal health records for shared optimization. Any later real examples need an explicit consent and redaction process. Store pilot traces locally outside the public repository, with external experiment tracking disabled. Preserve the existing provider privacy settings in all evaluation calls, including reflection and judging; a new SDK will not automatically inherit our TypeScript adapter's settings.

Measure a small baseline before choosing a dollar budget. A proposed first search budget is 300–600 scenario evaluations, subject to a separate total spending cap and wall-clock limit. One scenario can require several model calls, and reflection, judging, image processing and final comparisons add further calls. Track actual provider usage for all of them; report infrastructure failures separately from prompt failures and account for bounded retries. No paid optimization run is started by this assessment.

GEPA's documented reflection-cost tracking does not account for our external TypeScript evaluator automatically. Its guide also warns that plain callable reflection providers report zero cost unless accounting is supplied. Therefore a reflection-only cap cannot enforce the total experiment budget. [Cost tracking guide](https://gepa-ai.github.io/gepa/guides/cost-tracking/).

Optimization runs would not add an optimizer call to every chat message. The selected prompt can still increase inference cost and latency if it becomes longer or causes additional tool rounds, so measure those alongside quality. Keep the model fixed for the first comparison; investigate cheaper models only after establishing a reliable evaluation baseline.

The next implementation should produce the evaluation fixtures and rubric, a Node runner plus Python GEPA bridge, and a baseline report before generating candidate prompts. The decision to adopt an optimized prompt depends on that measured comparison. This research does not change the live Coach, add schedules or connect Apple Health.
