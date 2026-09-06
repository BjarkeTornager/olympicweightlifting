"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
export default function MobileSignIn() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [parameters, setParameters] = useState<{
    challenge: string;
    state: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const params = new URLSearchParams(location.search),
        challenge = params.get("challenge") ?? "",
        state = params.get("state") ?? "";
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(state)
      ) {
        setError("Open sign-in from the Lift Journal iPhone app.");
        return;
      }
      setParameters({ challenge, state });
      fetch("/api/session", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw Error();
          const data = await r.json();
          if (!active) return;
          setUser(data.user);
          setReady(true);
        })
        .catch(() =>
          setError("Sign-in is unavailable. Try again from the app."),
        );
    });
    return () => {
      active = false;
    };
  }, []);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      if (!parameters) return;
      const response = await fetch(
        user ? "/api/mobile/authorize" : "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(user ? { "X-Journal-Account": user.id } : {}),
          },
          body: JSON.stringify(
            user
              ? parameters
              : {
                  provider: "google",
                  callbackURL: `/mobile?${new URLSearchParams(parameters)}`,
                  errorCallbackURL: "/?signin=failed",
                },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error ?? "This journal is invitation only.");
      const target = user ? data.callback : data.url;
      if (
        typeof target !== "string" ||
        (user && !target.startsWith("liftjournal://auth?"))
      )
        throw Error("Start sign-in again from the app.");
      location.assign(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Try again.");
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <p className="eyebrow">LIFT JOURNAL FOR IPHONE</p>
      <h1 className="mt-4">Your health, with you.</h1>
      <p className="lead mt-4">
        Connect the iPhone app to your private journal. Access is limited to the
        owner and invited Google accounts.
      </p>
      {user && <p className="my-6">Continue as {user.name}.</p>}
      {error && (
        <p role="alert" className="error-text my-6">
          {error}
        </p>
      )}
      {ready && parameters && (
        <Button className="mt-6" disabled={busy} onClick={signIn}>
          {busy
            ? "Connecting…"
            : user
              ? "Connect iPhone app"
              : "Continue with Google"}
        </Button>
      )}
      <p className="fine-print mt-8">
        Your journal stays in your account. <a href="/privacy">Privacy</a>
      </p>
    </main>
  );
}
