"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dumbbell,
  LockKeyhole,
  LogIn,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import type { Identity } from "@/lib/model";
import { Button } from "./ui/button";

export type AuthOptions = {
  google: boolean;
  localPassword: boolean;
  configured: boolean;
  canInvite?: boolean;
  signinFailed?: boolean;
};
export type PrivateSessionProps = {
  identity: Identity;
  auth: AuthOptions;
  onSessionInvalid: () => void;
};
const PrivateJournal = dynamic(
  () => import("./journal").then((module) => module.Journal),
  {
    ssr: false,
    loading: () => (
      <main className="opening">
        <h1>Opening your journal…</h1>
      </main>
    ),
  },
);
type Phase = "checking" | "authenticated" | "signed-out" | "unavailable";

function Landing({
  auth,
  phase,
  retry,
}: {
  auth: AuthOptions;
  phase: Phase;
  retry: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const signInError =
    error ||
    (auth.signinFailed
      ? "Could not sign in. Use the Google account the owner invited, or ask the owner for access."
      : "");
  const signIn = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw Error("Could not sign in. Check your invitation and try again.");
      if (result.url) location.assign(result.url);
      else location.reload();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Sign-in is unavailable. Please try again.",
      );
      setBusy(false);
    }
  };
  return (
    <div className="public-landing">
      <header className="landing-header">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Dumbbell size={22} />
          </span>{" "}
          LIFT JOURNAL
        </Link>
        <a href="/privacy">Privacy</a>
      </header>
      <main className="landing-main">
        <div className="landing-intro">
          <span className="landing-kicker">
            <LockKeyhole size={15} /> A PERSONAL SPACE FOR YOUR HEALTH
          </span>
          <h1>
            Your health.
            <br />
            <em>Your private space.</em>
          </h1>
          <p className="lead">
            Bring your training, nutrition and recovery together with a coach
            that knows your journal.
          </p>
          <div className="landing-signin">
            {phase === "checking" ? (
              <p role="status">Checking your session…</p>
            ) : phase === "unavailable" ? (
              <>
                <p role="status">
                  Connect to verify your session. Your journal stays locked
                  until you’re signed in.
                </p>
                <Button onClick={retry}>
                  Check connection <ArrowRight size={17} />
                </Button>
              </>
            ) : auth.google ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void signIn("sign-in/social", {
                    provider: "google",
                    callbackURL: location.origin + "/" + location.hash,
                    errorCallbackURL: location.origin + "/?signin=failed",
                  })
                }
              >
                <LogIn size={18} />
                {busy ? "Opening sign-in…" : "Continue with Google"}
              </Button>
            ) : !auth.localPassword ? (
              <>
                <p role="status">Sign-in is temporarily unavailable.</p>
                <Button variant="secondary" onClick={retry}>
                  Check connection
                </Button>
              </>
            ) : null}
            {auth.localPassword && phase === "signed-out" && (
              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void signIn("sign-in/email", {
                    email: data.get("email"),
                    password: data.get("password"),
                  });
                }}
              >
                <p>Local development sign-in</p>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <Button disabled={busy}>Sign in</Button>
              </form>
            )}
            {signInError && (
              <p className="error-text" role="alert">
                {signInError}
              </p>
            )}
            <p className="landing-assurance">
              Invitation only. Sign in to access your own profile and records.
            </p>
          </div>
        </div>
        <section
          className="landing-coach"
          aria-label="What your journal brings together"
        >
          <span className="coach-avatar">
            <Sparkles size={24} />
          </span>
          <h2>A clearer picture of your day.</h2>
          <p>One conversation connects the details that matter to you.</p>
          <ul>
            <li>
              <strong>Train with purpose</strong>
              <span>Workouts, programmes and your progress.</span>
            </li>
            <li>
              <strong>Understand your nutrition</strong>
              <span>Meals, images and your daily food journal.</span>
            </li>
            <li>
              <strong>Make room for recovery</strong>
              <span>Sleep, energy and your daily check-in.</span>
            </li>
          </ul>
          <div className="landing-private-note">
            <LockKeyhole size={16} />
            <span>Your journal is visible only after sign-in.</span>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        Training · Nutrition · Recovery{" "}
        <a href="/privacy">How your data is handled</a>
      </footer>
    </div>
  );
}

export function AccessGate() {
  const [user, setUser] = useState<Identity | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [auth, setAuth] = useState<AuthOptions>({
    google: false,
    localPassword: false,
    configured: false,
  });
  const requestId = useRef(0),
    controller = useRef<AbortController | null>(null),
    expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lock = useCallback(() => {
    requestId.current++;
    controller.current?.abort();
    if (expiry.current) clearTimeout(expiry.current);
    document.documentElement.setAttribute("data-session-locked", "");
    setUser(null);
    setPhase("signed-out");
    try {
      localStorage.removeItem("lift-cloud:identity");
    } catch {}
  }, []);
  const verify = useCallback(
    async (conceal = false) => {
      const id = ++requestId.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const timeout = setTimeout(() => abort.abort(), 8000);
      if (conceal) {
        document.documentElement.setAttribute("data-session-locked", "");
        setPhase("checking");
      }
      try {
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) throw Error("Session verification unavailable");
        const session = await response.json();
        if (id !== requestId.current) return;
        setAuth({
          google: Boolean(session.google),
          localPassword: Boolean(session.localPassword),
          configured: Boolean(session.configured),
          canInvite: Boolean(session.canInvite),
          signinFailed:
            new URLSearchParams(location.search).get("signin") === "failed",
        });
        if (!session.user) {
          lock();
          return;
        }
        const remaining = session.expiresAt
          ? new Date(session.expiresAt).getTime() - Date.now()
          : null;
        if (
          remaining != null &&
          (!Number.isFinite(remaining) || remaining <= 0)
        ) {
          lock();
          return;
        }
        if (typeof session.user.id !== "string" || !session.user.id)
          throw Error("Invalid session");
        setUser(session.user);
        const hidden = document.visibilityState === "hidden";
        document.documentElement.toggleAttribute("data-session-locked", hidden);
        setPhase(hidden ? "checking" : "authenticated");
        if (expiry.current) clearTimeout(expiry.current);
        if (remaining != null)
          expiry.current = setTimeout(lock, Math.min(remaining, 2147483647));
      } catch {
        if (id !== requestId.current) return;
        document.documentElement.setAttribute("data-session-locked", "");
        setPhase("unavailable");
      } finally {
        clearTimeout(timeout);
      }
    },
    [lock],
  );
  useEffect(() => {
    // Old local identities are deliberately not consulted for authorization.
    try {
      localStorage.removeItem("lift-cloud:identity");
    } catch {}
    const initial = setTimeout(() => void verify(true), 0);
    const show = () => {
      if (document.visibilityState === "visible") void verify(true);
    };
    const hide = () => {
      requestId.current++;
      controller.current?.abort();
      document.documentElement.setAttribute("data-session-locked", "");
      setPhase("checking");
    };
    const visibility = () =>
      document.visibilityState === "hidden" ? hide() : show();
    const offline = () => {
      hide();
      setPhase("unavailable");
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void verify();
    }, 15000);
    window.addEventListener("lift-session-invalid", lock);
    window.addEventListener("online", show);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visibility);
    const generation = requestId;
    return () => {
      clearTimeout(initial);
      generation.current++;
      controller.current?.abort();
      if (expiry.current) clearTimeout(expiry.current);
      clearInterval(interval);
      window.removeEventListener("lift-session-invalid", lock);
      window.removeEventListener("online", show);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [lock, verify]);
  return (
    <>
      {user && (
        <div className="private-shell" hidden={phase !== "authenticated"}>
          <PrivateJournal
            key={user.id}
            identity={user}
            auth={auth}
            onSessionInvalid={lock}
          />
        </div>
      )}
      {phase !== "authenticated" && (
        <Landing auth={auth} phase={phase} retry={() => void verify(true)} />
      )}
    </>
  );
}
