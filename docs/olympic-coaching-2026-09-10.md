# Lifting coaching: source review and product changes

Reviewed 10 September 2026. Source: Sonny Webster, [World’s Most Expensive Weightlifting Coaching](https://www.youtube.com/watch?v=hbNN2PnqFr4). I reviewed the full auto-generated transcript and selected visual sections; the transcript may contain recognition errors. This is primarily a demonstration of a paid coaching service, not a technique tutorial or independent evidence of its results.

## Useful lessons from the video

| Section | Principle worth applying |
| --- | --- |
| [3:23–6:48](https://www.youtube.com/watch?v=hbNN2PnqFr4&t=203s) | Assess the athlete before prescribing. Explain the priority and choose drills suited to their level. |
| [6:50–9:18](https://www.youtube.com/watch?v=hbNN2PnqFr4&t=410s) | Fit the roadmap, preparation and accessory work around the person’s real schedule. |
| [9:20–12:44](https://www.youtube.com/watch?v=hbNN2PnqFr4&t=560s) | Review the training response and whether feedback helped; adjust the program when needed. |
| [12:48–15:33](https://www.youtube.com/watch?v=hbNN2PnqFr4&t=768s) | Combine regular reflection with education and revisiting goals. |

The strongest transferable idea is a repeated assessment → priority → experiment → review cycle. Pricing, result guarantees and the service’s time commitment are not a basis for claiming effectiveness or imposing universal rules. Its human video review, direct contact and live sessions cannot be represented as features our app has.

## Cross-check against coaching literature

Greg Everett’s [program selection guide](https://www.catalystathletics.com/article/2252/Guide-to-Training-Program-Selection/) also makes program choice dependent on experience, focus, workload and availability. His [weights and reps article](https://www.catalystathletics.com/article/2054/How-Do-I-Select-Weights-Reps-in-a-Weightlifting-Program/) emphasizes selecting and refining prescriptions through records, observation and discussion with the particular athlete. Reliable maximums matter for percentage prescriptions; a recorded top set alone does not establish one. These support personalization and review rather than a single formula.

## Implemented in Lift Journal

- **Train → Lifting coach** brings together an editable personal brief, an ongoing-workout link, a four-week evidence view and focused conversation starters.
- The brief records the athlete’s goal, motivation, self-described experience, available days and minutes, equipment, schedule constraints, current priority and optional target date. Only the goal is required. It syncs within the existing private journal and is included in JSON exports.
- The website and `lifting_review` tool use the same deterministic calculation. Completed history is separate from active work. Explicit made/missed outcomes, unrated sets, actual reps, source sessions, reported effort samples and sleep coverage remain distinguishable. Pending targets and future-dated training are excluded. There are no inferred technique, readiness or injury scores.
- Lifting guidance is retrieved with this tool for relevant conversations, keeping the detailed instructions out of routine food and health requests. It asks for one meaningful priority, rationale, suitable cue or drill when supported, observable check and subsequent review.
- Existing editable program tools carry the roadmap, warm-up, main work, purposeful accessories, rest, load selection and progression checks in program/day/exercise notes. Unknown loads remain unknown. Reading a summary never replaces reading a full record before editing it.
- Coach can prepare a reviewed brief update or clear it on request. Ordinary workout logging retains its existing direct-save/Undo behavior. Advice and proposed training are not completed workouts. Approved follow-up plans remain in the existing plans system and appear on visits.
- Source links open the relevant training date and session. Conversation starters draft an editable message and preserve existing text and queued work; they do not call a model merely by opening the workspace.

## Limits and validation

The app can inspect requested still images, which can support discussion of visible positions. It cannot assess continuous movement, bar speed or timing from those images and does not offer personal lifting-video upload analysis. A qualified coach observing the movement remains necessary for assessments that need that evidence.

Automated checks use synthetic journals and model tool-call stubs to verify evidence calculations, private ownership, read-before-write checks, explicit review, atomic save/retry/Undo, stale-write protection, older-client compatibility, navigation and mobile accessibility. They do not establish equivalence to expert human coaching, prove the quality of arbitrary live model responses, or constitute a new GEPA optimization result. The system-policy hash is deliberately updated with this domain addition; earlier optimization scores must not be attributed to it.
