"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { privateFetch } from "@/lib/private-fetch";
import { Button } from "./ui/button";

type Invitation = {
  id: string;
  email: string;
  revokedAt: string | null;
  joined: boolean;
};
export function Invitations({ accountId }: { accountId: string }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await privateFetch("/api/invitations", {
        headers: { "X-Journal-Account": accountId },
        signal,
      });
      if (!r.ok) throw Error("Could not load invitations. Try again.");
      return (await r.json()).invitations as Invitation[];
    },
    [accountId],
  );
  const show = (items: Invitation[]) => {
    setInvitations(items);
    setLoaded(true);
  };
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) show(items);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Could not load invitations. Try again.");
      });
    return () => abort.abort();
  }, [load]);
  const change = async (
    method: "POST" | "DELETE",
    body: unknown,
    message: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await privateFetch("/api/invitations", {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Journal-Account": accountId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok)
        throw Error((await r.json()).error ?? "Could not update invitations.");
      if (method === "POST") setEmail("");
      setNotice(message);
      show(await load());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update invitations.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="panel invitation-panel"
      aria-labelledby="invitations-title"
    >
      <div className="eyebrow">OWNER ONLY</div>
      <h2 id="invitations-title">Invitations</h2>
      <p>
        Choose who can join. Each person signs in with Google and gets their own
        private journal.
      </p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void change(
            "POST",
            { email },
            "Access granted. Copy the invitation and share it with this person.",
          );
        }}
      >
        <label>
          Google account email
          <input
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            disabled={busy}
          />
        </label>
        <Button type="submit" disabled={busy || !email.trim()}>
          <UserPlus size={17} /> Grant access
        </Button>
      </form>
      <p className="fine-print">
        No email is sent automatically. Only the exact Google account you invite
        can use the invitation.
      </p>
      {notice && (
        <p className="fine-print" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="error-text">{error}</p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError("");
              void load()
                .then(show)
                .catch(() =>
                  setError("Could not load invitations. Try again."),
                );
            }}
          >
            Reload invitations
          </Button>
        </div>
      )}
      {!loaded && !error && <p role="status">Loading invitations…</p>}
      {loaded && !invitations.length && (
        <p className="muted">Only you have access. No invitations yet.</p>
      )}
      {invitations.length > 0 && (
        <ul className="invitation-list">
          {invitations.map((invite) => (
            <li key={invite.id}>
              <div>
                <strong className="invitation-email">{invite.email}</strong>
                <span className="fine-print">
                  {invite.revokedAt
                    ? "Access revoked"
                    : invite.joined
                      ? "Joined · access active"
                      : "Invited · waiting for Google sign-in"}
                </span>
              </div>
              <div className="button-row">
                {!invite.revokedAt && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `You're invited to Lift Journal. Sign in with Google using ${invite.email}: ${location.origin}/`,
                        );
                        setNotice(
                          "Invitation copied. Share it with the person you invited.",
                        );
                      } catch {
                        setError(
                          "Could not copy. Share this site's address and ask them to use the invited Google account.",
                        );
                      }
                    }}
                  >
                    <Copy size={15} /> Copy invitation
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void change(
                      invite.revokedAt ? "POST" : "DELETE",
                      invite.revokedAt
                        ? { email: invite.email }
                        : { id: invite.id },
                      invite.revokedAt
                        ? "Access restored. They can sign in with Google again."
                        : "Access revoked and signed-in sessions ended. Their saved journal is retained.",
                    )
                  }
                >
                  {invite.revokedAt ? "Restore access" : "Revoke access"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
