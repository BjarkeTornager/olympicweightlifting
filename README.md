# Lift Journal

Lift Journal is a mobile-first Olympic weightlifting program and training log for personal use. It is a dependency-free static web app that runs on GitHub Pages, stores data locally, and can be installed on an iPhone home screen.

## What it includes

- Dashboard with current PRs, total, bodyweight, immediate targets, weekly programming, and recent sessions
- Persistent in-progress workouts: start a programmed day, log each set, navigate away, and resume later
- Set-level weight, reps, RPE, and optional success/miss status
- Separate athlete notes, coach cues, and overall coach notes
- Editable and deletable training history with exercise and date filters
- Editable PRs with possible-PR prompts after finishing a workout
- Dependency-free SVG progress charts for six core lifts
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
