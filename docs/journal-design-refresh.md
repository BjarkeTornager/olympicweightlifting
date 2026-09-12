# Journal design refresh

Implemented and published on 7 September 2026. See the [verified Railway release](coach-design-deployment-2026-09-07.md) for the deployed source and checks.

## Direction

The [Airbnb homepage](https://www.airbnb.com/) informed the use of generous spacing, a neutral canvas, clear navigation, rounded image corners and restrained emphasis. The journal keeps its own identity and uses no Airbnb artwork or assets.

`app/journal-design.css` defines the shared presentation after the existing functional styles: charcoal text, white surfaces, a rose accent, quieter cards, consistent heading sizes and a compact mobile chat composer. Existing viewport, Safari keyboard, chat scrolling, offline and authentication behavior remain in place.

## Navigation and conversation

- Mobile has four direct destinations: Coach, Train, Food and Health. More opens the complete journal menu with History, Progress, Images, Cardio, Exercises, Home and Settings. Cardio also remains available inside Train.
- Desktop navigation groups the daily destinations and journal tools. Its list scrolls independently when vertical space is limited.
- The More dialog supports keyboard navigation, Escape, focus restoration, current destination indicators and immediate dismissal after choosing a link.
- Coach uses a full white canvas, underlined view tabs and a smaller, raised composer. Optional suggestions remain dismissible; the empty mobile conversation has less introductory copy.
- Saved galleries use larger, rounded thumbnails and clear captions, with existing authenticated enlargement and download. Data ownership and image retrieval are unchanged by the visual refresh.
- Food totals have a simpler comparison layout. Training, food, health, image libraries, dialogs and the public sign-in page share the revised visual language.
- Routine device-save timestamps no longer occupy a second header row. Pending changes and Undo still appear, and the sync status remains visible.

## Icons

Replaced Lucide with [Phosphor React](https://github.com/phosphor-icons/react), pinned to `@phosphor-icons/react@2.1.10` (MIT). The central semantic exports in `components/ui/icons.ts` use individual context-free SSR imports, avoiding the package-wide icon barrel. Navigation uses regular and filled weights; selected feature icons use duotone. No icon fonts or third-party image requests are needed.

## Verification

The navigation browser test exercises every destination, the dialog at 320/390/768px, keyboard focus return, desktop navigation and accessibility. Existing Coach tests cover responsive layout, keyboard and scrolling behavior, streaming, review/save/undo, private gallery display and account changes. The full test results are recorded with the delivery rather than implying that a local build has been deployed.

Verified locally: production build, typecheck, lint, 23 progression tests and 67 domain/database/auth tests (none skipped). The full 117-test browser suite passed across Chromium, WebKit and Firefox. After the last introductory-copy and gallery refinements, all 12 relevant browser checks and nine Coach/formatting unit tests passed again. Accessibility checks at 320, 390, 768 and 1440px are included in those browser tests. The dependency lockfile passes an offline npm-ci dry run; installation reported zero vulnerabilities.
