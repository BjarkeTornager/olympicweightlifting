# Coach GEPA experiment: logging and tool-use rules — 27 September 2026

**Decision: keep the current rules.** GEPA proposed eight rewrites of the paragraphs that decide how Coach saves and corrects records. None was reliably better on conversations it hadn't seen, and the best one repeated fixed rules it was told to leave alone. The run did confirm one real failure worth fixing directly (below). Total spend was $0.66, plus about $0.10 on harness test runs, against a $10 cap.

The harness is described in [scripts/gepa/README.md](../scripts/gepa/README.md#logging-and-tool-use-rules-workflow-harness). The earlier experiment, which tuned Coach's tone, is in [gepa-coach-experiment-2026-09-07.md](gepa-coach-experiment-2026-09-07.md).

## Setup

- **Editable text:** the seven paragraphs about check-ins, `log_entry`, set corrections, change plus answer, corrections, workout continuity and bundles (8,746 characters). Health, privacy, evidence, "one change per reply" and untrusted-content rules stayed fixed.
- **Model:** Coach on Luna (`openai/gpt-5.6-luna`) with production prompt caching. Reflection on Terra.
- **Conversations:** the Jev workflow benchmark's 12 scripted scenarios in English and Danish, plus three new held-out single-fact reports (bodyweight, sleep, a walk). Split by scenario: 5 train, 4 validation, 6 held-out.
- **Score:** journal checks and Jev's missed-request and wrong-change flags decide pass or fail. A passing turn loses 0.1 per model round beyond the first.
- **Water:** the benchmark predates drink logging and expected water on the check-in. The app now counts drink entries, so water was checked as the day's total the way the app computes it. Without this, GEPA would have been rewarded for contradicting the app's own drinks rule.

## Results

| | Current rules | Selected candidate |
| --- | --- | --- |
| Validation score (8 conversations) | 0.913 | 0.925 |
| Held-out, 12 conversations × 2 | 24/24 passed, mean 0.933 | 24/24 passed, mean 0.929 |
| Held-out rounds per conversation | 2.00 | 2.04 |
| Length | 8,746 characters | 6,987 characters |

The other candidates scored 0.788 and 0.917 on validation. The candidate isn't eligible: its held-out mean is lower, and the differences on both splits are within sampling noise.

What the runs show:

- **Coach is already reliable on this benchmark.** With the current rules, 29 of the 30 distinct conversations (scenario and language) passed on every repeat. That leaves little for a rewrite to gain on correctness.
- **One real failure: correcting the day's water total in English.** The English conversation ending in "Correct today's water total to 1.25 litres, replacing 750 ml" failed in 4 of 5 runs with the current rules, including both runs with the corrected water check. The Danish one passed all 5. Coach either offered to delete the drink for review and said the new total could be recorded "after you confirm", or saved nothing. The first message sometimes also recorded the 750 ml both as a drink and on the check-in. The GEPA candidate passed it 3/3, including both English runs, so clearer wording helps. Fixing it directly, as one reviewed sentence about correcting a water total through drink entries, is safer than adopting the whole rewrite.
- **The rewrite duplicated fixed rules.** It copied fixed text into the editable part (for example which messages are not logging requests, and repeating a saved meal), although told not to. Shipping it would make the prompt harder to review and could let the copies drift from the originals.
- **Fewer rounds needs a structural change, not wording.** Even a one-fact report takes two model rounds: read `health_overview`, then save. No candidate removed that read, and the fixed rules ask for it. Today's records are already in the context, so the server supplying that read (step 4 of [the speed and cost plan](coach-speed-and-cost-with-jev-2026-09-27.md)) remains the better way to cut a round.

## Cost

| | Calls | Cost |
| --- | --- | --- |
| Coach (Luna), 146 scored conversations | 404 | $0.38 |
| Reflection (Terra), 8 proposals | 8 | $0.27 |
| Jev flags | 214 | $0.01 |
| Total, this run | | **$0.66** |

With the shared prompt cached, a scored conversation cost about $0.0026. A larger search is affordable if a future benchmark has more failures to learn from.

## Limits

- Twelve scenarios, several of them easy, don't discriminate much between good candidates. The held-out set in particular passed 100% with both texts.
- Only Luna was tested. Terra and Astra turns weren't covered.
- Jev's flags catch most, not all, missed requests (7 of 9 in the September benchmark).
- Synthetic accounts and scripted messages only; no production conversations were read.

## Reproducibility

Raw transcripts stay in a private local run directory, outside the repository.

| Component | SHA-256 |
| --- | --- |
| Current editable rules | `b46ab98423ab1b089811304ad69539667bd185477b000b904695257582457bed` |
| Fixed prompt with placeholder | `20fecedfb932e9014887341bff85fc0fad9979e09c92d377a954adf2bb7e2135` |
| Selected candidate | `7a3e7bcd…` (not promoted) |

The source was `main` at `cfbd159`, with GEPA 0.1.4 and seed 17.
