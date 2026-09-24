"use client";
import { LogIn } from "@/components/ui/icons";
import type { PrivateSessionProps } from "./access-gate";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function SignInDialog({
  open,
  onOpenChange,
  auth,
  onMessage: setMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auth: PrivateSessionProps["auth"];
  onMessage: (message: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
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
              credentials: "include",
              redirect: "manual",
              body: JSON.stringify({
                provider: "google",
                disableRedirect: true,
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
            Cloud sign-in is being configured. You can keep training and export
            your journal from Settings.
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
  );
}
