# Lift Journal

Lift Journal is a mobile-first Olympic weightlifting program and training log for personal use. It is a dependency-free static web app that runs on GitHub Pages, stores data locally, and can be installed on an iPhone home screen.

## What it includes

- Dashboard with an immediate Start/Resume action, selectable training week, compact PRs, targets, and recent sessions
- Platform-inspired visual theme with an overhead-lift SVG illustration, competition-plate accents, and scoreboard-style PRs; no external fonts or images required
- Persistent in-progress workouts: start a programmed day, log each set, navigate away, and resume later
- Set-level weight, reps, optional RPE, and explicit made/miss or logged status
- One expanded exercise at a time, quick weight adjustments, copy-previous-set controls, and previous-session reference
- A live program with next-session loads on Home and Workout, automatically increased from explicitly logged training
- Weight and rep edits carry forward to later unlogged sets without overwriting direct edits
- Technique overlay, collapsible notes, and a bottom workout action within thumb reach
- Separate athlete notes, coach cues, and overall coach notes
- Editable and deletable training history with exercise and date filters
- Editable PRs with possible-PR prompts after finishing a workout
- A selectable SVG progress chart for six core lifts, with 30-day, 90-day, and all-time views
- Searchable Catalyst Athletics exercise library with privacy-enhanced YouTube embeds
- Versioned JSON export/import
- Installable PWA with an offline app shell
- Repository-relative paths for `https://USERNAME.github.io/REPOSITORY/`

## Run locally

No install or build step is required. From the project directory:

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>. A local HTTP server is required because browsers do not allow service workers or JavaScript modules from `file://` URLs.

Run all static checks with:

```bash
npm run check
```

There are no npm dependencies; the script only uses Node.js itself.

### End-to-end browser tests

Use a recent Node.js version with built-in WebSocket support (Node 22 or later)
and Google Chrome. Start Chrome in a separate
terminal with a temporary profile:

```bash
chrome_profile=$(mktemp -d /tmp/lift-journal-browser.XXXXXX)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-first-run \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223 \
  --user-data-dir="$chrome_profile" about:blank
```

Then run `npm run test:e2e`. On other operating systems, use the local Chrome
executable path. `CDP_PORT` can override the debugging port.

The suite serves the production files under a repository subpath on a temporary
local port, creates a separate browser context, and disposes both afterward. It
never clears data in an existing tab. It uses touch and keyboard events for logging,
checks all six views at widths from 320 to 1440 pixels, and covers drafts,
history, PRs, chart filters, backups, and offline use with the test server stopped.
YouTube media responses
are stubbed; the separate video verification command checks live availability.
Screenshots and a JSON report are saved to `/tmp/lift-journal-e2e-results`
(override with `E2E_OUTPUT`). Browser emulation does not replace testing Safari
and the on-screen keyboard on a physical iPhone.

The video catalog can be rechecked against YouTube at any time (internet required):

```bash
npm run verify:videos
```

The 13 unique Catalyst Athletics videos bundled with this version were last checked on 30 August 2026. The verification checks both YouTube metadata and the privacy-enhanced embed endpoint.

## Project structure

```text
index.html                 Semantic app shell and dialogs
styles.css                Mobile-first visual system and responsive layout
js/data.js                Athlete defaults, PRs, exercise library, and program definition
js/storage.js             Versioned local persistence, migration, export, and import
js/progression.js         Pure progression rules, target planning, and explicit set logging
js/app.js                 Views, workout workflow, charts, and interactions
manifest.webmanifest       PWA metadata and repository-relative start URL
sw.js                      Same-origin offline app-shell cache
assets/                    App, maskable, and Apple touch icons
scripts/check.mjs          Dependency-free structural validation
.github/workflows/         GitHub Pages deployment workflow
```

The program definition and user logs are deliberately separate. Each completed session stores a prescription snapshot, so a later program update—or a future server-delivered program from coach Tim—will not rewrite training history.

## Edit the weekly program

Edit `PROGRAM_DEFINITION` in [`js/data.js`](./js/data.js). Every programmed exercise has:

- `exerciseId`
- `sets`
- `reps`
- `recommendation`
- `initialWeight`
- `notes`
- `priority`
- `videoRef`

Exercise descriptions, cues, video IDs, and Catalyst source links live in `EXERCISES` in the same file. Keep IDs stable once sessions have been logged.

## Automatic progression

The Home training-day selector and Workout program cards show each lift's
**next session load**, set/rep prescription, and increase or hold status.
Start a session and these loads are applied automatically; no recovery opt-in
or separate strong-set confirmation is required. Exercise headings show the
calculated prescription instead of the original fixed loading range.

Choose **Limited · repeat previous loads** under **Recovery today** when needed.
Changing recovery or the session date only recalculates untouched exercises;
entered work is preserved. Automatic mode does not assess your recovery for you.

The next workout for the same program and training day adds **2.5 kg** when:

- The most recent earlier workout includes the exercise.
- Every prescribed working set is explicitly logged, with no misses.
- Every set meets the snapshotted weight and rep targets.
- No recorded RPE is invalid or above 8 (RPE is optional).
- Neither the previous session nor the current session has limited recovery.

Logging every prescribed set and finishing the workout is sufficient. The
Complete exercise button advances the workout, but it is not an extra condition
for progression. Strong-set feedback remains optional.

The baseline is the lightest successful working-set load, so a heavy single
does not raise every set next time. The prescribed set count and rep target
stay unchanged. Warm-ups mixed into the working sets can prevent an increase.
The program previews the next increase immediately after saving successful
work. If you trained that day already, the preview states when the new loads
become available; repeating today uses today's prescription. Same-date repeats
and future-dated history cannot compound increases. Old sessions with explicit
made/miss or logged results can qualify. Old touched/prefilled rows without
explicit results supply a load reference only, never evidence of successful work.

Each weighted program exercise defines `progression: { step: 2.5 }`.
The original loading ranges are starting guidance, not permanent ceilings:
successful training can progress 45 → 47.5 → 50 → 52.5 kg and continue beyond
the original range. A custom `maxWeight` can still impose a deliberate ceiling,
but the bundled program does not set one. Saturday's coached loads and
accessories with unspecified weights stay manual. PR edits alone do not
change the program's starting weights.

Existing drafts upgrade their untouched presets to the current progression
rules once. Recorded sets, manually edited values, notes, and saved history
are preserved. Imported old drafts use the same upgrade path.

Within a workout, a weight or rep change updates later unlogged sets unless
that value was edited directly. It does not mark those sets performed.
Changing a recorded weight or rep count clears its previous result.
Use **Made**, **Miss**, or **Log set** to record each set. **Complete exercise**
requires every remaining set to be logged; finishing a partial workout saves
only the recorded sets. Partial sessions and deleted prescribed sets do not
qualify for an increase.

Targets and progression reasons are included in drafts, history, and JSON
backups. `npm run check` includes progression unit tests; `npm run test:e2e`
also verifies successive increases, recovery holds, and draft persistence.

## Data storage and backups

Training data is stored under one versioned `localStorage` key. This is appropriate for the small, text-oriented dataset and works consistently in iOS Safari without adding a database dependency. The storage adapter is isolated in `js/storage.js`, so IndexedDB, browser SQLite/WASM, or a remote API can replace it later without rewriting the UI model.

Important limitations:

- Browser data is specific to one device and browser.
- Clearing Safari website data removes local workouts.
- Deleting and reinstalling a PWA may remove its local data depending on iOS behavior.
- Export a JSON backup regularly and before changing phones.
- YouTube videos are not cached and require internet access.

Every exported file includes a root `schemaVersion`, export timestamp, app/program metadata, profile, PRs, sessions, and any active workout draft.

## Install on iPhone

1. Deploy the site over HTTPS with GitHub Pages.
2. Open the deployed URL in Safari.
3. Tap **Share**.
4. Tap **Add to Home Screen**.
5. Open Lift Journal once while online so the app shell is cached.

The installed app works for viewing and logging while offline. External YouTube content still needs a connection.

## Deploy to GitHub Pages

The included workflow validates the app, packages only the production files, and deploys on every push to `main`. It uses GitHub's custom Pages workflow source, so no branch-specific `/docs` folder or root-domain assumptions are needed.

### New repository with GitHub CLI

Replace `olympicweightlifting` if you want a different repository name. `--public` is the simplest GitHub Pages option; choose `--private` only if your GitHub plan supports Pages for private repositories.

```bash
cd /Users/bjarketornager/olympicweightlifting
git init
git add .
git commit -m "Build Lift Journal PWA"
git branch -M main
gh auth status
gh auth login -h github.com --web
gh repo create olympicweightlifting --public --source=. --remote=origin --push
gh api --method POST "repos/{owner}/{repo}/pages" -f build_type=workflow
gh workflow run deploy-pages.yml
gh run watch
gh api "repos/{owner}/{repo}/pages" --jq .html_url
```

Inside this repository, GitHub CLI expands `{owner}` and `{repo}` automatically. If the Pages site already exists, the `POST` command returns a conflict; update it instead:

```bash
gh api --method PUT "repos/{owner}/{repo}/pages" -f build_type=workflow
gh workflow run deploy-pages.yml
```

### Connect an existing empty repository

```bash
cd /Users/bjarketornager/olympicweightlifting
git init
git add .
git commit -m "Build Lift Journal PWA"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Then open **Repository → Settings → Pages**, set **Source** to **GitHub Actions**, and run:

```bash
gh workflow run deploy-pages.yml
gh run watch
```

The resulting URL is `https://USERNAME.github.io/REPOSITORY/`.

## Updating the PWA

Change `CACHE_NAME` in `sw.js` whenever app-shell files change after deployment. The service worker removes older shell caches during activation. User workouts are not kept in the cache and are unaffected by a shell update.

## Privacy

The app has no analytics, authentication, or backend. User-entered training data remains in the browser unless explicitly exported. Loading or opening a technique video connects to YouTube/Catalyst Athletics under their own privacy terms.
