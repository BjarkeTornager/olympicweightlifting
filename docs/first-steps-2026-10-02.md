# First steps on the iPhone

2 October 2026. The main measure is full days: sleep, food and movement all recorded (docs/product-principles.md). This release gets a new person there sooner.

## The problem

A new account opened on Today with nothing to do first:

- the Energy and Protein rings had no targets, and the iPhone had no way to set goals except asking Coach;
- "Connect Apple Health" was one card among several, and repeated on tiles that didn't open it;
- the empty food card said "Tell Coach what you ate" but opened a chart.

Asked to set goals, Coach then asked one question at a time, about ten replies before any target existed.

## What changed

**Get started**, a card on the iPhone's Today below the rings, with three steps:

| Step | Done when | Opens |
|---|---|---|
| Connect Apple Health: sleep, steps and workouts arrive by themselves | Anything only the Apple Health sync writes is in the journal (an imported night, a daily summary, a smart-scale reading), or the phone has connected | The Apple Health screen |
| Log your first meal: take a photo and Coach works out the rest | Any meal is recorded | Coach, straight into the camera (photo library without one) |
| Set your goals: Coach turns your weight and goal into daily targets | A calorie target is set | Coach, with "Help me set my goals" ready to send |

Apple Health covers sleep and movement and a meal covers food, so the three together make the first full day. Goals give the rings their targets.

- The server sends `firstSteps` in Today (optional, so older builds ignore it) for a journal's first two weeks, until all three are done. Accounts older than that never see the card.
- Done steps show a check mark. The card can be hidden with ×; that stays on the phone until sign-out.
- While the card shows, the separate "Connect Apple Health" card doesn't, since the card already includes it.
- Coach opens through the AI permission screen when that hasn't been given yet, then carries on with the camera or the message.

**Coach asks for goal details in two messages**, body facts first (age, sex, height, weight), then the goal, activity, training days and experience. Tried live on a new account: two replies, then a reviewed goals card of 1,760 kcal and 144 g protein. Saving it ticked the step.

## How we'll know

The usage page's full days per week and week-4 retention for the people who join after this release, compared with earlier sign-ups. `coach.change.set_body_goals` and `health.sync.app` in the feature list show whether the steps are taken.

## Not included

- The website keeps its own goals card and Apple Health Shortcut setup.
- The tiles' "Connect Apple Health" text still opens their charts.
