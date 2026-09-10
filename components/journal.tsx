"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  Cloud,
  CloudOff,
  Dumbbell,
  History,
  House,
  LogIn,
  Settings,
  Sparkles,
  Undo2,
  WifiOff,
  Utensils,
  HeartPulse,
  Images,
  SquaresFour,
  PersonSimpleRun,
} from "@/components/ui/icons";
import { useJournal } from "@/lib/use-journal";
import type { PrivateSessionProps } from "./access-gate";
import { backup, days, today, createWorkout } from "@/lib/domain";
import { liftingPrompt } from "@/lib/lifting-coach";
import { trainingPrograms } from "@/lib/training-programs";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Dashboard } from "./views/dashboard";
import { Workouts } from "./views/workouts";
import { TrainingAgent } from "./agent";
import { FoodView } from "./views/food";
import { CardioView } from "./cardio";
import { HealthView } from "./health";
import { ImageLibrary } from "./image-library";
import {
  HistoryView,
  ProgressView,
  LibraryView,
  SettingsView,
  downloadBackup,
} from "./views/records";
export type JournalController = ReturnType<typeof useJournal>;
const navigation = [
  { id: "coach", label: "Coach", icon: Sparkles },
  { id: "workout", label: "Train", icon: Dumbbell },
  { id: "food", label: "Food", icon: Utensils },
  { id: "health", label: "Health", icon: HeartPulse },
  { id: "history", label: "History", icon: History },
  { id: "progress", label: "Progress", icon: BarChart3 },
  { id: "images", label: "Images", icon: Images },
  { id: "cardio", label: "Cardio", icon: PersonSimpleRun },
  { id: "library", label: "Exercises", icon: BookOpen },
  { id: "dashboard", label: "Home", icon: House },
  { id: "data", label: "Settings", icon: Settings },
];
const primaryNavigation = navigation.slice(0, 4);
const journalNavigation = navigation.slice(4);
const navigationDescriptions: Record<string, string> = {
  history: "Your logged workouts",
  progress: "Trends and personal bests",
  images: "Your private photo library",
  cardio: "Runs, rides and movement",
  library: "Exercise guides and videos",
  dashboard: "Your training overview",
  data: "Profile, preferences and access",
};
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
  const [route, setRoute] = useState("coach"),
    [login, setLogin] = useState(false),
    [message, setMessage] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  // Navigation changes the Coach view, never the lifetime of its active run.
  // Keep entry intents stable while using other sections, including photo loads.
  const [coachEntry, setCoachEntry] = useState({ route: "coach", id: 0 });
  const moreButton = useRef<HTMLButtonElement>(null);
  const [updateReady, setUpdateReady] = useState(false),
    [worker, setWorker] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    const changed = () => {
      const next = location.hash.slice(1) || "coach";
      setRoute(next);
      if (next.split("/")[0] === "coach")
        setCoachEntry((entry) => ({ route: next, id: entry.id + 1 }));
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    const activated = () => setUpdateReady(false);
    changed();
    window.addEventListener("hashchange", changed);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.addEventListener("controllerchange", activated);
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          setWorker(reg);
          if (reg.waiting && navigator.serviceWorker.controller)
            setUpdateReady(true);
          reg.addEventListener("updatefound", () =>
            reg.installing?.addEventListener("statechange", () => {
              if (reg.waiting && navigator.serviceWorker.controller)
                setUpdateReady(true);
            }),
          );
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("hashchange", changed);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          activated,
        );
    };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const refreshKeyboard = () => {
      const editing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      // Safari blurs the input before the keyboard finishes closing. Keep the
      // compact layout until the viewport recovers so Send cannot move between
      // touch-down and click, and the conversation doesn't collapse mid-send.
      const open =
        viewport.scale === 1 &&
        inset > 150 &&
        (editing ||
          document.documentElement.hasAttribute("data-keyboard-open"));
      document.documentElement.toggleAttribute("data-keyboard-open", open);
      document.documentElement.style.setProperty(
        "--coach-viewport-height",
        `${viewport.height}px`,
      );
      document.documentElement.style.setProperty(
        "--coach-viewport-top",
        `${viewport.offsetTop}px`,
      );
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${open ? inset : 0}px`,
      );
      if (
        open &&
        document.activeElement instanceof HTMLElement &&
        !document.activeElement.closest(".coach-mode")
      ) {
        const bounds = document.activeElement.getBoundingClientRect();
        if (
          bounds.bottom > viewport.offsetTop + viewport.height - 90 ||
          bounds.top < viewport.offsetTop
        )
          document.activeElement.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
      }
    };
    refreshKeyboard();
    viewport.addEventListener("resize", refreshKeyboard);
    viewport.addEventListener("scroll", refreshKeyboard);
    window.addEventListener("focusin", refreshKeyboard);
    window.addEventListener("focusout", refreshKeyboard);
    return () => {
      viewport.removeEventListener("resize", refreshKeyboard);
      viewport.removeEventListener("scroll", refreshKeyboard);
      window.removeEventListener("focusin", refreshKeyboard);
      window.removeEventListener("focusout", refreshKeyboard);
      document.documentElement.removeAttribute("data-keyboard-open");
      document.documentElement.style.removeProperty("--keyboard-inset");
      document.documentElement.style.removeProperty("--coach-viewport-height");
      document.documentElement.style.removeProperty("--coach-viewport-top");
    };
  }, []);
  const go = (target: string) => {
    location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const start = async (id: string, date = today()) => {
    if (!state) return;
    if (state.activeWorkout) {
      go(`workout/${id}`);
      return;
    }
    await journal.update((s) => {
      s.activeWorkout = createWorkout(
        s,
        days.find((d) => d.id === id),
        date,
      );
    });
    go("workout");
  };
  const section = route.split("/")[0];
  return (
    <div
      className={`journal ${section === "coach" ? "coach-mode" : ""} ${state?.preferences.largeText ? "large-text" : ""}`}
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
        <a className="brand" href="#coach">
          <span className="brand-icon">
            <Dumbbell size={22} />
          </span>
          <span>
            Lift<span className="brand-light">Journal</span>
          </span>
        </a>
        <nav aria-label="Primary" className="sidebar-navigation">
          {[primaryNavigation, journalNavigation].map((group, index) => (
            <div className="sidebar-nav-group" key={index}>
              <span className="sidebar-label">
                {index === 0 ? "Your day" : "Your journal"}
              </span>
              {group.map(({ id, label, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`nav-item ${section === id ? "active" : ""}`}
                  aria-current={section === id ? "page" : undefined}
                >
                  <Icon
                    size={22}
                    weight={section === id ? "fill" : "regular"}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </a>
              ))}
            </div>
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
            <ArrowUpRight size={16} />
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
        {state && (journal.record?.dirty || journal.record?.undo) && (
          <div className="save-detail">
            <span>
              {journal.record?.dirty
                ? "Changes waiting to sync"
                : identity && journal.record?.lastSyncedAt
                  ? `Cloud checked ${new Date(journal.record.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "This browser holds your offline copy"}{" "}
              · Device saved{" "}
              {new Date(state.updatedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {journal.record?.undo && !journal.record.conflict && (
              <Button
                variant="ghost"
                onClick={() =>
                  void journal
                    .undo()
                    .then(() => setMessage("Last change undone."))
                    .catch((e) => setMessage(e.message))
                }
              >
                <Undo2 size={15} />
                Undo last change
              </Button>
            )}
          </div>
        )}
        {updateReady && (
          <div className="notice">
            <span>
              A new version is ready. Your saved workout will be kept.
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                if (!worker?.waiting) {
                  setUpdateReady(false);
                  return;
                }
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  () => location.reload(),
                  { once: true },
                );
                worker?.waiting?.postMessage({ type: "ACTIVATE" });
              }}
            >
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
        {journal.record?.conflict && (
          <div className="notice warning">
            <div>
              <strong>Another device has newer changes.</strong>
              <p>
                Your work is still saved here. Export both copies before
                choosing which version to sync.
              </p>
              <div className="button-row">
                <Button
                  variant="secondary"
                  onClick={() => downloadBackup(backup(state!), "this-device")}
                >
                  Export this device
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadBackup(
                      backup(journal.record!.conflict!.state),
                      "server-copy",
                    )
                  }
                >
                  Export server copy
                </Button>
                <Button onClick={() => void journal.resolveConflict("local")}>
                  Use this device’s version
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void journal.resolveConflict("server")}
                >
                  Use server version
                </Button>
              </div>
            </div>
          </div>
        )}
        {!state ? (
          <div className="opening">
            <Dumbbell size={40} />
            <h1>Opening your journal…</h1>
            <p>Your training will appear here.</p>
          </div>
        ) : (
          <>
            <TrainingAgent
              key={identity?.id ?? "guest"}
              visible={section === "coach"}
              entryId={coachEntry.id}
              initialVideoReview={/^coach\/lifting\/(video|technique)$/.test(
                coachEntry.route,
              )}
              initialTrainingPrompt={
                /^coach\/lifting\/(video|technique)$/.test(coachEntry.route)
                  ? undefined
                  : coachEntry.route.startsWith("coach/lifting/")
                    ? liftingPrompt(coachEntry.route.split("/")[2])
                    : coachEntry.route === "coach/training/new"
                      ? "Help me build a reusable training program in Train. My goal is "
                      : coachEntry.route.startsWith("coach/training/")
                        ? `Update my saved training program “${trainingPrograms(state).find((p) => p.id === coachEntry.route.split("/")[2])?.name ?? "my program"}”: `
                        : undefined
              }
              initialCardioLog={
                coachEntry.route === "coach/cardio" ||
                /^coach\/photo\/[^/]+\/cardio$/.test(coachEntry.route)
              }
              initialSleepLog={
                coachEntry.route === "coach/sleep" ||
                /^coach\/photo\/[^/]+\/sleep$/.test(coachEntry.route)
              }
              initialPhotoId={
                coachEntry.route.startsWith("coach/photo/")
                  ? coachEntry.route.split("/")[2]
                  : undefined
              }
              journal={journal}
              onLogin={() => setLogin(true)}
              go={go}
            />
            {section === "dashboard" && (
              <Dashboard state={state} onStart={start} go={go} />
            )}
            {["workout", "history", "cardio"].includes(section) && (
              <nav
                className="activity-switch training-tabs"
                aria-label="Training navigation"
              >
                <a
                  href="#workout"
                  aria-current={
                    section === "workout" && route === "workout"
                      ? "page"
                      : undefined
                  }
                >
                  Ongoing{state.activeWorkout ? " •" : ""}
                </a>
                <a
                  href="#workout/choose"
                  aria-current={
                    section === "workout" &&
                    route !== "workout" &&
                    route !== "workout/coaching"
                      ? "page"
                      : undefined
                  }
                >
                  Programs
                </a>
                <a
                  href="#workout/coaching"
                  aria-current={
                    route === "workout/coaching" ? "page" : undefined
                  }
                >
                  Lifting coach
                </a>
                <a
                  href="#history"
                  aria-current={section === "history" ? "page" : undefined}
                >
                  History
                </a>
                <a
                  href="#cardio"
                  aria-current={section === "cardio" ? "page" : undefined}
                >
                  Cardio
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
                onLogin={() => setLogin(true)}
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
                onLogin={() => setLogin(true)}
                go={go}
              />
            )}
            {section === "data" && (
              <SettingsView
                journal={journal}
                onLogin={() => setLogin(true)}
                notify={setMessage}
              />
            )}
            {!navigation.some((n) => n.id === section) && (
              <div className="empty">
                <h1>Let’s get you back to training.</h1>
                <Button onClick={() => go("dashboard")}>Open Home</Button>
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
            className={
              section === id ||
              (["cardio", "history"].includes(section) && id === "workout")
                ? "active"
                : ""
            }
            aria-current={
              section === id ||
              (["cardio", "history"].includes(section) && id === "workout")
                ? "page"
                : undefined
            }
          >
            <Icon
              size={25}
              weight={
                section === id ||
                (["cardio", "history"].includes(section) && id === "workout")
                  ? "fill"
                  : "regular"
              }
              aria-hidden="true"
            />
            <span>{label}</span>
          </a>
        ))}
        <button
          className={
            journalNavigation.some(
              (item) =>
                item.id === section && !["cardio", "history"].includes(section),
            )
              ? "active"
              : ""
          }
          aria-label="More"
          ref={moreButton}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <SquaresFour
            size={25}
            aria-hidden="true"
            weight={moreOpen ? "fill" : "regular"}
          />
          <span>More</span>
        </button>
      </nav>
      <Dialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="Your journal"
        description="Everything you’ve saved, in one place."
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          moreButton.current?.focus({ preventScroll: true });
        }}
      >
        <nav className="journal-menu" aria-label="More destinations">
          {journalNavigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setMoreOpen(false)}
            >
              <span className="journal-menu-icon">
                <Icon size={24} weight="duotone" aria-hidden="true" />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{navigationDescriptions[id]}</small>
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </Dialog>
      <Dialog
        open={login}
        onOpenChange={setLogin}
        title="Your training. Everywhere."
        description="Sign in to keep your journal in sync across devices. Bring existing device workouts across from Settings."
      >
        {auth.google ? (
          <Button
            className="full"
            onClick={async () => {
              const response = await fetch("/api/auth/sign-in/social", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  provider: "google",
                  callbackURL: location.origin,
                }),
              });
              const result = await response.json();
              if (result.url) location.href = result.url;
              else setMessage(result.message ?? "Sign-in is unavailable.");
            }}
          >
            <LogIn size={18} />
            Continue with Google
          </Button>
        ) : (
          !auth.localPassword && (
            <p className="notice">
              Cloud sign-in is being configured. You can keep training and
              export your journal from Settings.
            </p>
          )
        )}
        {auth.localPassword && (
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const response = await fetch(
                `/api/auth/${data.get("mode") === "create" ? "sign-up" : "sign-in"}/email`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: data.get("email"),
                    password: data.get("password"),
                    name: "Local athlete",
                  }),
                },
              );
              const result = await response.json();
              if (!response.ok)
                setMessage(result.message ?? "Could not sign in.");
              else location.reload();
            }}
          >
            <p className="muted">Local development sign-in</p>
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              Action
              <select name="mode">
                <option value="signin">Sign in</option>
                <option value="create">Create local account</option>
              </select>
            </label>
            <Button type="submit">Continue</Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
