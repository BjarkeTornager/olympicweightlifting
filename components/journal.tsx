"use client";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useJournal } from "@/lib/use-journal";
import { backup, days, today, createWorkout } from "@/lib/domain";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Dashboard } from "./views/dashboard";
import { Workouts } from "./views/workouts";
import { TrainingAgent } from "./agent";
import { FoodView } from "./views/food";
import { HealthView } from "./health";
import { RestTimer } from "./rest-timer";
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
  { id: "dashboard", label: "Home", icon: House },
  { id: "workout", label: "Train", icon: Dumbbell },
  { id: "food", label: "Food", icon: Utensils },
  { id: "health", label: "Health", icon: HeartPulse },
  { id: "history", label: "History", icon: History },
  { id: "progress", label: "Progress", icon: BarChart3 },
  { id: "library", label: "Exercises", icon: BookOpen },
  { id: "data", label: "Settings", icon: Settings },
];
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
export function Journal() {
  const journal = useJournal();
  const { state, identity, status, auth, error } = journal;
  const [route, setRoute] = useState("coach"),
    [login, setLogin] = useState(false),
    [message, setMessage] = useState("");
  const [updateReady, setUpdateReady] = useState(false),
    [worker, setWorker] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    const changed = () => {
      setRoute(location.hash.slice(1) || "coach");
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
      const open = editing && viewport.scale === 1 && inset > 150;
      document.documentElement.toggleAttribute("data-keyboard-open", open);
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${open ? inset : 0}px`,
      );
      if (open && document.activeElement instanceof HTMLElement) {
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
    viewport.addEventListener("resize", refreshKeyboard);
    window.addEventListener("focusin", refreshKeyboard);
    window.addEventListener("focusout", refreshKeyboard);
    return () => {
      viewport.removeEventListener("resize", refreshKeyboard);
      window.removeEventListener("focusin", refreshKeyboard);
      window.removeEventListener("focusout", refreshKeyboard);
      document.documentElement.removeAttribute("data-keyboard-open");
      document.documentElement.style.removeProperty("--keyboard-inset");
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
      className={`journal ${state?.preferences.largeText ? "large-text" : ""}`}
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
            LIFT<span className="brand-light">JOURNAL</span>
          </span>
        </a>
        <span className="sidebar-label">YOUR HEALTH SPACE</span>
        <nav aria-label="Primary">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-item ${section === id ? "active" : ""}`}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
              {section === id && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="account-button"
            onClick={() => (identity ? go("data") : setLogin(true))}
          >
            <span className="avatar">L</span>
            <span>
              <strong>Your journal</strong>
              <small>
                {identity
                  ? "Training · nutrition · recovery"
                  : "Sign in for device sync"}
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
        {state && (
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
            {section === "coach" && (
              <TrainingAgent
                key={`${identity?.id ?? "guest"}:${route}`}
                initialPhotoId={
                  route.startsWith("coach/photo/")
                    ? route.split("/")[2]
                    : undefined
                }
                journal={journal}
                onLogin={() => setLogin(true)}
                go={go}
              />
            )}
            {section === "workout" && state.activeWorkout && (
              <RestTimer
                key={identity?.id ?? "guest"}
                accountId={identity?.id ?? "guest"}
                duration={state.preferences.restSeconds ?? 90}
              />
            )}
            {section === "dashboard" && (
              <Dashboard state={state} onStart={start} go={go} />
            )}
            {section === "workout" && (
              <Workouts
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
        {navigation
          .filter((n) => !["dashboard", "library", "health"].includes(n.id))
          .map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
            </a>
          ))}
      </nav>
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
