# General gym exercise library — 7 September 2026

The shared library now contains 53 entries, including 30 new gym movements. Existing exercise IDs, programmes and saved training data are preserved. Back and front squat descriptions now describe general strength training as well as their Olympic-lifting use.

Gym training and Olympic lifting can be filtered separately. Search supports common aliases, muscle groups and equipment in the library, routine builder, workout exercise picker and Coach's `exercises` tool. Train links directly to the library. Each new exercise includes technique cues, source attribution, a YouTube demonstration and logging conventions.

## Video selection and verification

29 new tutorials come from [PureGym's exercise library](https://www.puregym.com/exercises/), which provides personal-trainer demonstrations. The seated leg curl uses the [National Academy of Sports Medicine guide](https://www.nasm.org/resource-center/exercise-library/seated-leg-curl). Each selected YouTube title and channel was checked against the intended movement. PureGym's seated cable row page embedded an incline dumbbell row, so the catalogue uses PureGym's separately published seated cable row tutorial instead.

`npm run verify:videos` passed for all 48 unique videos across the catalogue on 7 September 2026: YouTube oEmbed metadata and embed pages returned HTTP 200, each new video's channel matched its recorded author, and no explicit embed restriction was detected. This checks availability and identity; it does not guarantee playback in every region or browser. Technique opens the video only on request and provides a direct YouTube link and written guide.

| Exercise | YouTube instruction | Written guide |
| --- | --- | --- |
| Barbell bench press | [PureGym](https://www.youtube.com/watch?v=CjHIKDQ4RQo) | [Guide](https://www.puregym.com/exercises/chest/bench-press/barbell-bench-press/) |
| Dumbbell bench press | [PureGym](https://www.youtube.com/watch?v=AduT4Eq-iP0) | [Guide](https://www.puregym.com/exercises/chest/bench-press/dumbbell-bench-press/) |
| Incline dumbbell press | [PureGym](https://www.youtube.com/watch?v=oZVCBM9f8Eo) | [Guide](https://www.puregym.com/exercises/chest/bench-press/incline-dumbbell-press/) |
| Machine chest press | [PureGym](https://www.youtube.com/watch?v=CIykDiF4sfg) | [Guide](https://www.puregym.com/exercises/chest/bench-press/seated-chest-press/) |
| Cable chest fly | [PureGym](https://www.youtube.com/watch?v=QcTcWpkn_bw) | [Guide](https://www.puregym.com/exercises/chest/chest-fly/cable-flyes/) |
| Push-up | [PureGym](https://www.youtube.com/watch?v=Env8gAr_QnE) | [Guide](https://www.puregym.com/exercises/chest/press-up/push-ups/) |
| Lat pulldown | [PureGym](https://www.youtube.com/watch?v=JGeRYIZdojU) | [Guide](https://www.puregym.com/exercises/back/lat-exercises/lat-pulldown/) |
| Seated cable row | [PureGym](https://www.youtube.com/watch?v=lJoozxC0Rns) | [Guide](https://www.puregym.com/exercises/back/rows/seated-cable-row/) |
| Single-arm dumbbell row | [PureGym](https://www.youtube.com/watch?v=ZRSGpBUVcNw) | [Guide](https://www.puregym.com/exercises/back/rows/single-arm-dumbbell-row/) |
| Pull-up | [PureGym](https://www.youtube.com/watch?v=PHdHnZcbsB8) | [Guide](https://www.puregym.com/exercises/back/pull-up/pull-ups/) |
| Dumbbell shoulder press | [PureGym](https://www.youtube.com/watch?v=aI2hGzsAMXs) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/shoulder-press/dumbbell-shoulder-press/) |
| Dumbbell lateral raise | [PureGym](https://www.youtube.com/watch?v=z-kOn7flIZg) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/lateral-raises/) |
| Cable face pull | [PureGym](https://www.youtube.com/watch?v=0Po47vvj9g4) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/rear-delt-exercises/face-pulls/) |
| Dumbbell reverse fly | [PureGym](https://www.youtube.com/watch?v=nlkF7_2O_Lw) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/rear-delt-exercises/rear-delt-flyes/) |
| Dumbbell biceps curl | [PureGym](https://www.youtube.com/watch?v=MtXdEcW3Eog) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/bicep-curl/dumbbell-bicep-curls/) |
| Hammer curl | [PureGym](https://www.youtube.com/watch?v=B4RznoFvTl4) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/bicep-curl/hammer-curls/) |
| Cable triceps pushdown | [PureGym](https://www.youtube.com/watch?v=LXkCrxn3caQ) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/tricep-extension/tricep-pushdowns/) |
| Dumbbell overhead triceps extension | [PureGym](https://www.youtube.com/watch?v=9wxRhONFsRA) | [Guide](https://www.puregym.com/exercises/arms-and-shoulders/tricep-extension/overhead-tricep-extension/) |
| Conventional deadlift | [PureGym](https://www.youtube.com/watch?v=GxsLrTzyGUU) | [Guide](https://www.puregym.com/exercises/legs/hamstring-exercises/deadlifts/conventional-deadlift/) |
| Goblet squat | [PureGym](https://www.youtube.com/watch?v=zBV3ceGyAxw) | [Guide](https://www.puregym.com/exercises/legs/quad-exercises/squats/goblet-squat/) |
| Seated leg press | [PureGym](https://www.youtube.com/watch?v=qCR9bN3G1t4) | [Guide](https://www.puregym.com/exercises/legs/quad-exercises/leg-presses/seated-leg-press/) |
| Leg extension | [PureGym](https://www.youtube.com/watch?v=4ZDm5EbiFI8) | [Guide](https://www.puregym.com/exercises/legs/quad-exercises/leg-extensions/) |
| Seated leg curl | [NASM](https://www.youtube.com/watch?v=_2Kd0d-JEUM) | [Guide](https://www.nasm.org/resource-center/exercise-library/seated-leg-curl) |
| Barbell hip thrust | [PureGym](https://www.youtube.com/watch?v=aweBS7K71l8) | [Guide](https://www.puregym.com/exercises/glutes/hip-thrusts/barbell-hip-thrust/) |
| Glute bridge | [PureGym](https://www.youtube.com/watch?v=tqp5XQPpTxY) | [Guide](https://www.puregym.com/exercises/glutes/glute-bridge/glute-bridges/) |
| Bulgarian split squat | [PureGym](https://www.youtube.com/watch?v=TEXl2b3__S4) | [Guide](https://www.puregym.com/exercises/legs/quad-exercises/squats/bulgarian-split-squat/) |
| Reverse lunge | [PureGym](https://www.youtube.com/watch?v=xrPteyQLGAo) | [Guide](https://www.puregym.com/exercises/legs/quad-exercises/lunges/reverse-lunges/) |
| Standing calf raise | [PureGym](https://www.youtube.com/watch?v=Zep-wKHWkNM) | [Guide](https://www.puregym.com/exercises/legs/calf-exercises/calf-raises/) |
| Hanging knee raise | [PureGym](https://www.youtube.com/watch?v=O7iDA3ory-w) | [Guide](https://www.puregym.com/exercises/abs/hanging-knee-raises/) |
| Abdominal crunch | [PureGym](https://www.youtube.com/watch?v=NnVhqMQRvmM) | [Guide](https://www.puregym.com/exercises/abs/crunches/) |

## Logging conventions

- Barbell: total load including the bar. Two dumbbells lifted together: combined load; a simultaneous movement counts as one rep.
- Single-arm row: the single dumbbell's load, with total repetitions across both arms. Other unilateral movements state their load and rep conventions explicitly.
- Bodyweight: zero kilograms, or additional external weight when loaded. Pull-up assistance belongs in notes, not in the added-weight field.
- Machine/cable: selected stack load; compare on the same machine. A two-stack cable fly records the combined selected load.

These notes appear beside workout sets, in the routine editor and in the technique dialog. Coach receives the same notes and is instructed to clarify ambiguous per-dumbbell or per-side logs before preparing a change. This does not convert any historical entries or introduce timed-exercise or assisted-weight schemas.

## Validation

- Production type checks, lint and static catalogue checks passed.
- 23 progression tests and 72 domain/database/authentication tests passed, including new gym catalogue/search tests, reviewed Coach logging, routine/history/progress round trips and the real Coach tool with an injected model.
- All 120 existing browser checks passed across Chromium, WebKit and Firefox. The six new gym checks passed after correcting test selectors and explicitly waiting for cloud saves before reload. They cover mobile filtering, accessible technique dialogs, attributed video links, routine persistence and preventing a stale selected exercise after changing search. Mobile library and technique screenshots were also inspected with synthetic data.
- No dependencies, account-access rules, database migrations or live coaching prompt-style changes are introduced.
