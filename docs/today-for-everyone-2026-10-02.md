# Today starts with the day, not a lifting programme

2 October 2026. Part of making Lift Journal a health app for everyone (docs/product-principles.md: lifting programmes are "reachable, not in the main path").

## Before

Every journal starts with the built-in programme as its active one, and nothing records whether the person chose it. So a brand-new account's Today led with "Snatch + Back Squat, Next in Stability & Power Base, day 1 of 4" above food and sleep. The iPhone app showed the same session on its Today card, and the voice coach was told it was the "next planned session".

## Now

Someone **follows a programme** when they made or chose a custom programme, or have logged a session from the built-in one (`nextTraining().following`). Only then:

- the website's Today shows the next session with Start workout;
- the app's Today gets `nextSession`, and its card shows "Next · programme";
- the voice coach hears about the next planned session.

Everyone else sees their day first. On the iPhone, the training card reads "Movement · Nothing recorded yet. Start a workout" and opens Train. An open workout always shows, so it can be resumed.

Train is unchanged. It still suggests the built-in programme's next session and lists the programmes to choose from, so a lifter is one tap away. Existing accounts that have trained the built-in programme see no difference.

## Tests

- `tests/daily-flow.test.ts`: a new journal doesn't follow; one logged built-in session does.
- `tests/native-api.test.ts`: `nextSession` is absent for a new journal and present after a logged session.
- `tests/browser/navigation.spec.ts`: a new journal's Today has no Start workout button.
- The app fixture `today.json` no longer has `nextSession`, since its journal follows no programme.
