# Product principles

Decided by the owner on 2 October 2026: **Lift Journal is a health app for everyone**, not only for people who lift. This page is the yardstick for every change. A feature that doesn't serve it doesn't ship, and an existing one that doesn't serve it is hidden, then removed.

## What it is, in two sentences

> Lift Journal is a private health journal you can talk to. Tell Coach how you slept, what you ate and how you moved, by voice, chat or photo, and it keeps the record and tells you what it means.

The same words are used on the sign-in screens, in the web manifest and in the TestFlight description. When the product changes, change these sentences first. If they need a third, the product has grown too wide. (Michael Seibel's test: someone who reads them can explain them back without questions.)

## Who it's for

Anyone who wants to look after their health without the chore of tracking: a first walk counts as much as a heavy snatch. People who lift seriously get depth (programmes, sets, Olympic lifting), but it doesn't come first in the product.

## What it covers

Five areas, and no more without evidence that people miss one:

1. **Sleep:** from Apple Health, or told to Coach.
2. **Food and drink:** meals by photo, voice or text; water; supplements.
3. **Movement and training:** activities from Apple Health, and workouts of any kind.
4. **Body:** weight and body fat.
5. **How you feel:** energy and soreness.

## The core loop

1. **Capture with almost no effort.** Apple Health first, then talking: a voice check-in, a chat message or a photo. Typing forms come last.
2. **See it.** Today shows the day. Journal shows the history and trends.
3. **Understand it and act.** Coach answers with the person's own numbers and suggests one useful next step.

Every screen should help with one of these. If it doesn't, it belongs behind a secondary control or nowhere.

## How we know it's working

- **Main measure:** recorded days per week per active person, meaning days with sleep, food and movement recorded.
- **Retention:** the share of each week's new people still recording in week 4. YC's guidance treats 20–30% as a healthy minimum ([How to measure your product](https://ycombinator.com/library/8C-how-to-measure-your-product-sus-2018)).
- **Feature use:** counted without content, per feature: how many people and how often. Decisions in the next section wait for these numbers.

## Where each feature stands

| | Features | What it means |
|---|---|---|
| **Core** | Today, Coach (chat, voice, photos), Journal and trends, Apple Health, Train (any workout), one reminder system, goals and targets | Polish and keep simple |
| **Specialist** | Olympic lifting video analysis, lifting programmes and the lifting coach brief, the exercise library, route maps | Reachable, not in the main path; no new work unless the numbers ask for it |
| **Merge** | Routines and programmes into one plan; the lifting coach brief into Coach; Images into the entries they belong to; web push reminders into the app's; the Apple Health Shortcut into the native app | One way to do each job |
| **To decide with data** | Coach's route planning and web search, invitations, backup import, merging sessions, the second voice provider and its 17 voices | Hide, measure, then keep or remove |

## Rules for new work

1. **One problem per release.** Each release has one theme tied to the main measure, and says what it removes or simplifies (Michael Seibel, [How to build product as a small startup](https://www.ycombinator.com/blog/how-to-build-product-as-a-small-startup/)).
2. **One way to do each job.** A second way to do something already possible needs a reason the first can't be fixed.
3. **A new feature names its problem, who has it, and how its use will be measured**, before it's built. Requests, ours included, go on a list and are judged against the main measure ("don't let any user hijack the roadmap").
4. **Better, not bigger.** Improving what exists (faster, clearer, fewer taps) is welcome at any time. Paul Graham's "keep pumping out features" means "one quantum of making users' lives better", not more complexity ([The Hardest Lessons](https://www.paulgraham.com/startuplessons.html)).
5. **Hide, measure, then remove,** with a note to the people who used it, and never delete their data. Google's 2026 Fitbit-to-Google Health switch shows what removing without warning costs.
6. **Satisfy all the needs of the people we serve before adding needs for more people** (Paul Graham, [Startups in 13 Sentences](https://paulgraham.com/13sentences.html)).
7. **Keep Coach small.** New tools load as skills, not always on. Every removed feature takes its tools with it. AI agents pick tools less accurately as the list grows.

## Background

- Feature creep review, 1 October 2026: an inventory of the website, app, Coach and services, with research on health-app retention, tracking burden and focus. It's summarised in the pull request that added this page.
- Y Combinator sources:
  - [YC's essential startup advice](https://ycombinator.com/blog/ycs-essential-startup-advice/): "Startup companies can only solve one problem well at any given time"
  - [Startup School recap](https://www.ycombinator.com/blog/startup-school-week-2-recap-michael-seibel-adora-cheung-and-ilya-volodarsky/): Seibel on narrow problems and cutting; Cheung on retention as the main measure
  - [How to pitch your company](https://www.ycombinator.com/blog/how-to-pitch-your-company/)
