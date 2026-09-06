"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cachedIdentity,
  cacheIdentity,
  changeLocal,
  getLocal,
  type LocalRecord,
} from "./local";
import type { Identity, JournalState, Snapshot } from "./model";
export type SyncStatus =
  | "loading"
  | "local"
  | "saved"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "signin"
  | "error";
export function useJournal() {
  const [record, setRecord] = useState<LocalRecord | null>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [status, setStatus] = useState<SyncStatus>("loading"),
    [error, setError] = useState("");
  const [auth, setAuth] = useState({
    google: false,
    localPassword: false,
    configured: false,
  });
  const account = useRef("guest"),
    channel = useRef<BroadcastChannel | null>(null),
    syncing = useRef(false),
    retry = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true);
  const publish = useCallback((value: LocalRecord) => {
    if (alive.current && value.accountId === account.current) {
      setRecord(value);
      channel.current?.postMessage(value.accountId);
    }
  }, []);
  const sync = useCallback(async () => {
    const accountId = account.current;
    if (accountId === "guest" || syncing.current) return;
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    syncing.current = true;
    const work = async () => {
      let local = await getLocal(accountId);
      if (local.conflict) {
        publish(local);
        setStatus("conflict");
        return;
      }
      setStatus("syncing");
      if (!local.dirty) {
        const response = await fetch("/api/journal", {
          headers: { "X-Journal-Account": accountId },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          setStatus("signin");
          return;
        }
        if (!response.ok) throw Error("Sync is temporarily unavailable.");
        const server = (await response.json()) as Snapshot;
        local = await changeLocal(accountId, (current) => {
          if (current.dirty) return current;
          // A restored database can be older than an already-confirmed device
          // copy. Preserve that copy for recovery instead of silently replacing it.
          if (server.revision < current.revision)
            return { ...current, conflict: server };
          return { ...current, state: server.state, revision: server.revision };
        });
        publish(local);
        setStatus(
          local.conflict ? "conflict" : local.dirty ? "saved" : "synced",
        );
        setError("");
        if (local.conflict || !local.dirty) return;
      }
      local = await changeLocal(accountId, (current) => ({
        ...current,
        pending: current.pending ?? {
          mutationId: crypto.randomUUID(),
          revision: current.revision,
          state: structuredClone(current.state),
          seq: current.seq,
        },
      }));
      const pending = local.pending!;
      const response = await fetch("/api/journal", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Journal-Account": accountId,
        },
        body: JSON.stringify(pending),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) {
        setStatus("signin");
        return;
      }
      const server = await response.json();
      if (response.status === 409) {
        publish(
          await changeLocal(accountId, (current) => ({
            ...current,
            conflict: { state: server.state, revision: server.revision },
          })),
        );
        setStatus("conflict");
        return;
      }
      if (!response.ok) {
        // A validation rejection did not commit. Allow a corrected local edit to
        // create a fresh pending mutation instead of retrying bad input forever.
        if ([400, 413, 422].includes(response.status)) {
          await changeLocal(accountId, (current) => ({
            ...current,
            pending: undefined,
          }));
        }
        throw Error(server.error ?? "Sync is temporarily unavailable.");
      }
      const next = await changeLocal(accountId, (current) => {
        if (
          server.revision !== pending.revision + 1 &&
          current.seq !== pending.seq
        )
          return {
            ...current,
            conflict: { state: server.state, revision: server.revision },
            pending: undefined,
          };
        return {
          ...current,
          revision: server.revision,
          pending: undefined,
          ...(current.seq === pending.seq
            ? { state: server.state, dirty: false }
            : { dirty: true }),
        };
      });
      publish(next);
      setStatus(next.conflict ? "conflict" : next.dirty ? "saved" : "synced");
      setError("");
    };
    try {
      if (navigator.locks)
        await navigator.locks.request(`lift-sync:${accountId}`, work);
      else await work();
    } catch (e) {
      setStatus(navigator.onLine ? "saved" : "offline");
      setError(e instanceof Error ? e.message : "Sync is unavailable.");
    } finally {
      syncing.current = false;
    }
  }, [publish]);
  useEffect(() => {
    alive.current = true;
    channel.current = new BroadcastChannel("lift-journal-sync");
    channel.current.onmessage = async (event) => {
      if (event.data === account.current)
        setRecord(await getLocal(account.current));
    };
    const init = async () => {
      let user = cachedIdentity();
      let authenticated = false;
      account.current = user?.id ?? "guest";
      setIdentity(user);
      publish(await getLocal(account.current));
      setStatus(user ? "saved" : "local");
      try {
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const session = await response.json();
          setAuth(session);
          if (session.user) {
            user = session.user;
            cacheIdentity(user);
            authenticated = true;
          } else if (!user) cacheIdentity(null);
        }
      } catch {}
      if (!alive.current) return;
      account.current = user?.id ?? "guest";
      setIdentity(user);
      const local = await getLocal(account.current);
      publish(local);
      setStatus(user ? (authenticated ? "saved" : "signin") : "local");
      if (authenticated) void sync();
    };
    void init().catch(() => {
      setError(
        "Device storage is unavailable. Enable website storage before logging workouts.",
      );
      setStatus("error");
    });
    const refresh = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const offline = () =>
      setStatus(account.current === "guest" ? "local" : "offline");
    window.addEventListener("online", sync);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(() => void sync(), 15000);
    return () => {
      alive.current = false;
      channel.current?.close();
      clearInterval(interval);
      if (retry.current) clearTimeout(retry.current);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync, publish]);
  const update = useCallback(
    async (fn: (state: JournalState) => JournalState | void) => {
      try {
        const next = await changeLocal(account.current, (current) => {
          const result = fn(current.state);
          current.state = result ?? current.state;
          current.state.updatedAt = new Date().toISOString();
          current.seq++;
          current.dirty = true;
          return current;
        });
        publish(next);
        setStatus(
          next.conflict
            ? "conflict"
            : account.current === "guest"
              ? "local"
              : "saved",
        );
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => void sync(), 1200);
        setError("");
      } catch (e) {
        setStatus("error");
        setError(
          e instanceof Error
            ? e.message
            : "Your latest edit could not be saved.",
        );
        throw e;
      }
    },
    [sync, publish],
  );
  const resolveConflict = async (choice: "local" | "server") => {
    publish(
      await changeLocal(account.current, (current) => {
        const remote = current.conflict;
        if (!remote) return current;
        return {
          ...current,
          state: choice === "server" ? remote.state : current.state,
          revision: remote.revision,
          conflict: undefined,
          pending: undefined,
          dirty: choice === "local",
          seq: current.seq + 1,
        };
      }),
    );
    await sync();
  };
  const signOut = async () => {
    const current = await getLocal(account.current);
    if (current.dirty || current.pending)
      throw Error(
        "Sync your pending work before signing out. You can also export a backup in Settings.",
      );
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw Error("Sign-out failed. Try again when online.");
    cacheIdentity(null);
    account.current = "guest";
    setIdentity(null);
    publish(await getLocal("guest"));
    setStatus("local");
  };
  return {
    state: record?.state ?? null,
    record,
    identity,
    status,
    error,
    auth,
    update,
    sync,
    resolveConflict,
    signOut,
  };
}
