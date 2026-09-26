"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Check,
  Cloud,
  CloudOff,
  Settings,
  WifiOff,
} from "@/components/ui/icons";
import {
  BarbellIcon,
  BowlIcon,
  GaugeIcon,
  KettlebellIcon,
  LogbookIcon,
  PhotoIcon,
  RisingBarsIcon,
  ShoeIcon,
  TickedLogIcon,
  TodayIcon,
  WhistleIcon,
} from "./ui/journal-icons";
import { trackKeyboardViewport } from "@/lib/keyboard-viewport";
import { useJournal } from "@/lib/use-journal";
import type { PrivateSessionProps } from "./access-gate";
import { days, today, createWorkout, program } from "@/lib/domain";
import { Button } from "./ui/button";
import { Today } from "./today";
import { WeeklyReview } from "./weekly-review";
import { Workouts } from "./views/workouts";
import { TrainingAgent } from "./agent";
import { FoodView } from "./views/food";
import { CardioView } from "./cardio";
import { HealthView } from "./health";
import { ImageLibrary } from "./image-library";
import { HistoryView } from "./views/history";
import { ProgressView } from "./views/progress";
import { LibraryView } from "./views/library";
import { SettingsView } from "./views/settings";
import { coachEntryIntent } from "@/lib/coach-entry";
import { useServiceWorkerUpdate } from "@/lib/use-service-worker";
import { SignInDialog } from "./sign-in-dialog";
import { SaveDetail, SyncConflictNotice } from "./journal-banners";
export type JournalController = ReturnType<typeof useJournal>;
const primaryNavigation = [
  { id: "today", label: "Today", icon: TodayIcon },
  { id: "workout", label: "Train", icon: BarbellIcon },
  { id: "coach", label: "Coach", icon: WhistleIcon },
  { id: "journal", label: "Journal", icon: LogbookIcon },
];
const journalNavigation = [
  { id: "food", label: "Food", icon: BowlIcon },
  { id: "health", label: "Health", icon: GaugeIcon },
  { id: "history", label: "History", icon: TickedLogIcon },
  { id: "progress", label: "Progress", icon: RisingBarsIcon },
  { id: "images", label: "Images", icon: PhotoIcon },
  { id: "cardio", label: "Cardio", icon: ShoeIcon },
  { id: "library", label: "Exercises", icon: KettlebellIcon },
];
const navigation = [...primaryNavigation, ...journalNavigation, { id: "data" }];
const navigationDescriptions: Record<string, string> = {
  food: "Meals, favourites and nutrition",
  health: "Sleep and daily check-ins",
  history: "Your logged workouts",
  progress: "Trends and personal bests",
  images: "Your private photo library",
  cardio: "Runs, rides and movement",
  library: "Exercise guides and videos",
};
const canonicalRoute = (route: string) =>
  ["", "dashboard", "coach/today"].includes(route)
    ? "today"
    : route === "coach/week"
      ? "journal/week"
      : route;
const labels = {
  loading: "Opening journal",
  local: "Saved on this device",
  saved: "Saved on this device",
  syncing: "Syncing",
  synced: "All changes synced",
  offline: "Offline · saved on device",
  conflict: "Review sync conflict",
  signin: "Sign in to sync",
  error: "Storage unavailable",
};
export function Journal(props: PrivateSessionProps) {
  const journal = useJournal(
    props.identity,
    props.auth,
    props.onSessionInvalid,
  );
  const { state, identity, status, auth, error } = journal;
  const [route, setRoute] = useState("today"),
    [login, setLogin] = useState(false),
    [message, setMessage] = useState("");
  // Navigation changes the Coach view, never the lifetime of its active run.
  // Keep entry intents stable while using other sections, including photo loads.
  const [coachEntry, setCoachEntry] = useState<{
    route: string;
    id: number;
    draft?: string;
  }>({ route: "coach", id: 0 });
  const draftIntent = useRef<string | undefined>(undefined);
  const { updateReady, activate: activateUpdate } = useServiceWorkerUpdate();
  useEffect(() => {
    const changed = () => {
      const next = canonicalRoute(location.hash.slice(1));
      setRoute(next);
      if (next.split("/")[0] === "coach") {
        const draft = draftIntent.current;
        draftIntent.current = undefined;
        setCoachEntry((entry) => ({ route: next, id: entry.id + 1, draft }));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    changed();
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(trackKeyboardViewport, []);
  const go = (target: string) => {
    location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const askCoach = (question: string) => {
    // Health context stays in memory, never in browser history or shared URLs.
    draftIntent.current = question;
    go("coach");
  };
  const start = async (id: string, date = today()) => {
    if (!state) return;
    if (state.activeWorkout) {
      go(`workout/${id}`);
      return;
    }
    await journal.update((s) => {
      if (days.some((d) => d.id === id)) s.program.activeProgramId = program.id;
      s.activeWorkout = createWorkout(
        s,
        days.find((d) => d.id === id),
        date,
      );
    });
    go("workout");
  };
  const section = route.split("/")[0];
  const activeNav = journalNavigation.some((n) => n.id === section)
    ? "journal"
    : section;
  return (
    <div
      className={`journal ${section === "coach" ? "coach-mode" : ""} ${section === "workout" ? "training-mode" : ""} ${state?.preferences.largeText ? "large-text" : ""}`}
    >
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#today">
          <span className="brand-icon">
            <BarbellIcon size={22} active />
          </span>
          <span>
            Lift<span className="brand-light">Journal</span>
          </span>
        </a>
        <nav aria-label="Primary" className="sidebar-navigation">
          {primaryNavigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-item ${activeNav === id ? "active" : ""}`}
              aria-current={activeNav === id ? "page" : undefined}
            >
              <Icon size={22} active={activeNav === id} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="account-button"
            onClick={() => (identity ? go("data") : setLogin(true))}
          >
            <span className="avatar" aria-hidden="true">
              {identity?.name?.trim().slice(0, 1).toUpperCase() || "L"}
            </span>
            <span>
              <strong>
                {identity?.name?.trim().split(/\s+/)[0] || "Your journal"}
              </strong>
              <small>
                {identity ? "Your private space" : "Sign in for device sync"}
              </small>
            </span>
          </button>
        </div>
      </aside>
      <main id="content" className="main" tabIndex={-1}>
        <header className="topbar">
          <span className="topbar-date">
            {state
              ? new Date().toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : "Your training space"}
          </span>
          <Button
            variant="ghost"
            className="account-settings"
            aria-label="Settings"
            onClick={() => go("data")}
          >
            <Settings size={19} />
          </Button>
          <button
            className={`sync-status ${status}`}
            onClick={() =>
              status === "signin" || !identity
                ? setLogin(true)
                : void journal.sync()
            }
            aria-label={labels[status]}
          >
            {status === "synced" ? (
              <Check size={15} />
            ) : status === "offline" ? (
              <WifiOff size={15} />
            ) : identity ? (
              <Cloud size={15} />
            ) : (
              <CloudOff size={15} />
            )}
            <span>{labels[status]}</span>
          </button>
        </header>
        <SaveDetail
          journal={journal}
          compact={section === "workout"}
          onMessage={setMessage}
        />
        {updateReady && (
          <div className="notice">
            <span>
              A new version is ready. Your saved workout will be kept.
            </span>
            <Button variant="secondary" onClick={activateUpdate}>
              Reload update
            </Button>
          </div>
        )}
        {error && (
          <div className="notice warning" role="status">
            {error}
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
            <button onClick={() => setMessage("")} aria-label="Dismiss message">
              ×
            </button>
          </div>
        )}
        <SyncConflictNotice journal={journal} />
        {!state ? (
          <div className="opening">
            <BarbellIcon size={40} />
            <h1>Opening your journal…</h1>
            <p>Your training will appear here.</p>
          </div>
        ) : (
          <>
            <TrainingAgent
              key={identity?.id ?? "guest"}
              visible={section === "coach"}
              entryId={coachEntry.id}
              {...coachEntryIntent(coachEntry.route, state, coachEntry.draft)}
              journal={journal}
              onLogin={() => setLogin(true)}
              go={go}
            />
            {section === "today" && (
              <Today journal={journal} go={go} onAsk={askCoach} />
            )}
            {section === "journal" && (
              <>
                <div className="page-heading compact">
                  <div>
                    <h1>Journal</h1>
                    <p className="lead">
                      Your records, whenever you need them.
                    </p>
                  </div>
                </div>
                {route === "journal/week" ? (
                  <WeeklyReview
                    journal={journal}
                    busy={false}
                    onAsk={askCoach}
                  />
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => go("journal/week")}
                    >
                      Your weekly review
                    </Button>
                    <nav
                      className="journal-menu journal-destinations"
                      aria-label="Journal destinations"
                    >
                      {journalNavigation.map(({ id, label, icon: Icon }) => (
                        <a key={id} href={`#${id}`}>
                          <span className="journal-menu-icon">
                            <Icon size={26} />
                          </span>
                          <span>
                            <strong>{label}</strong>
                            <small>{navigationDescriptions[id]}</small>
                          </span>
                          <ChevronRight size={18} aria-hidden="true" />
                        </a>
                      ))}
                    </nav>
                  </>
                )}
              </>
            )}
            {journalNavigation.some((n) => n.id === section) && (
              <a className="journal-back" href="#journal">
                ← Journal
              </a>
            )}
            {section === "workout" && (
              <nav
                className="activity-switch training-tabs"
                aria-label="Training navigation"
              >
                <a
                  href="#workout"
                  aria-current={route === "workout" ? "page" : undefined}
                >
                  Workout{state.activeWorkout ? " •" : ""}
                </a>
                <a
                  href="#workout/choose"
                  aria-current={
                    route !== "workout" && route !== "workout/coaching"
                      ? "page"
                      : undefined
                  }
                >
                  Programs
                </a>
              </nav>
            )}
            {section === "cardio" && <CardioView journal={journal} go={go} />}
            {section === "workout" && (
              <Workouts
                accountId={identity?.id ?? "guest"}
                state={state}
                update={journal.update}
                route={route}
                go={go}
                onStart={start}
                notify={setMessage}
              />
            )}
            {section === "history" && (
              <HistoryView
                key={route}
                sessionId={route.split("/")[1]}
                state={state}
                update={journal.update}
                go={go}
                notify={setMessage}
              />
            )}
            {section === "progress" && (
              <ProgressView
                state={state}
                update={journal.update}
                notify={setMessage}
              />
            )}
            {section === "library" && <LibraryView />}
            {section === "health" && (
              <HealthView
                key={identity?.id ?? "guest"}
                journal={journal}
                go={go}
              />
            )}
            {section === "images" && (
              <ImageLibrary
                key={identity?.id ?? "guest"}
                accountId={identity?.id}
                onLogin={() => setLogin(true)}
                go={go}
              />
            )}
            {section === "food" && (
              <FoodView
                key={identity?.id ?? "guest"}
                journal={journal}
                go={go}
              />
            )}
            {section === "data" && (
              <SettingsView
                key={route}
                trackingOpen={route === "data/sleep"}
                journal={journal}
                onLogin={() => setLogin(true)}
                notify={setMessage}
              />
            )}
            {!navigation.some((n) => n.id === section) && (
              <div className="empty">
                <h1>Let’s get you back to training.</h1>
                <Button onClick={() => go("today")}>Open Today</Button>
              </div>
            )}
          </>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {primaryNavigation.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            className={activeNav === id ? "active" : ""}
            aria-current={activeNav === id ? "page" : undefined}
          >
            <Icon size={25} active={activeNav === id} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <SignInDialog
        open={login}
        onOpenChange={setLogin}
        auth={auth}
        onMessage={setMessage}
      />
    </div>
  );
}
