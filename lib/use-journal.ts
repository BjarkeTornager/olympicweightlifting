"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  changeLocal,
  getLocal,
  removeConfirmedLocal,
  type LocalRecord,
} from "./local";
import type { Identity, JournalState, Snapshot } from "./model";
import {
  foodStateForUndo,
  coachStateForUndo,
  hasCoachData,
} from "./food-compatibility";
import { privateFetch } from "./private-fetch";
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
export function useJournal(
  identity: Identity,
  auth: {
    google: boolean;
    localPassword: boolean;
    configured: boolean;
    canInvite?: boolean;
  },
  onSessionInvalid: () => void,
) {
  const [record, setRecord] = useState<LocalRecord | null>(null),
    [status, setStatus] = useState<SyncStatus>("loading"),
    [error, setError] = useState("");
  const account = useRef(identity.id),
    channel = useRef<BroadcastChannel | null>(null),
    syncing = useRef<AbortController | null>(null),
    syncFinished = useRef<Promise<void> | null>(null),
    retry = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true);
  const publish = useCallback((value: LocalRecord) => {
    if (alive.current && value.accountId === account.current) {
      setRecord(value);
      channel.current?.postMessage(value.accountId);
    }
  }, []);
  const sync = useCallback(
    async (fresh = false) => {
      const accountId = account.current;
      // A Coach save can finish while a background GET is still returning an
      // older snapshot. Explicit refreshes must read again after that request.
      while (fresh && syncing.current && !syncing.current.signal.aborted)
        await syncFinished.current;
      if (
        !alive.current ||
        account.current !== accountId ||
        accountId === "guest" ||
        (syncing.current && !syncing.current.signal.aborted)
      )
        return;
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      const controller = new AbortController();
      syncing.current = controller;
      let finishSync!: () => void;
      syncFinished.current = new Promise<void>((resolve) => {
        finishSync = resolve;
      });
      const requestSignal = () =>
        AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
      const checkActive = () => controller.signal.throwIfAborted();
      try {
        let local = await getLocal(accountId);
        checkActive();
        if (local.conflict) {
          publish(local);
          setStatus("conflict");
          return;
        }
        // A background read must not disable Coach every 15 seconds. A failed
        // refresh still marks the connection unavailable; pending edits stay gated.
        setStatus((current) =>
          !local.dirty && !local.pending && current === "synced"
            ? current
            : "syncing",
        );
        if (!local.dirty && !local.pending) {
          const requestedRevision = local.revision;
          // Reads need no cross-tab write lock. An old/suspended tab can hold
          // that lock indefinitely, which used to strand a clean journal here.
          const response = await privateFetch("/api/journal", {
            headers: { "X-Journal-Account": accountId },
            cache: "no-store",
            signal: requestSignal(),
          });
          if (response.status === 401) {
            onSessionInvalid();
            return;
          }
          if (!response.ok) throw Error("Sync is temporarily unavailable.");
          const server = (await response.json()) as Snapshot;
          checkActive();
          local = await changeLocal(accountId, (current) => {
            checkActive();
            if (current.dirty || current.pending) return current;
            // Another tab may have confirmed a newer revision during this read.
            if (
              server.revision < current.revision &&
              current.revision !== requestedRevision
            )
              return current;
            // A restored database can be older than an already-confirmed device
            // copy. Preserve that copy for recovery instead of silently replacing it.
            if (server.revision < current.revision)
              return { ...current, conflict: server };
            return {
              ...current,
              state: server.state,
              foodTagsVersion: 1,
              coachJournalVersion: 1,
              revision: server.revision,
              lastSyncedAt: new Date().toISOString(),
              undo:
                server.revision === current.revision &&
                (current.coachJournalVersion === 1 ||
                  !hasCoachData(server.state))
                  ? current.undo
                  : undefined,
            };
          });
          publish(local);
          setStatus(
            local.conflict ? "conflict" : local.dirty ? "saved" : "synced",
          );
          setError("");
          if (local.conflict || (!local.dirty && !local.pending)) return;
        }
        const write = async () => {
          checkActive();
          // Re-read under the write lock: another tab may have already synced it.
          local = await getLocal(accountId);
          checkActive();
          if (local.conflict || (!local.dirty && !local.pending)) {
            publish(local);
            setStatus(local.conflict ? "conflict" : "synced");
            setError("");
            return;
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
          const response = await privateFetch("/api/journal", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Journal-Account": accountId,
            },
            body: JSON.stringify(pending),
            signal: requestSignal(),
          });
          if (response.status === 401) {
            onSessionInvalid();
            return;
          }
          const server = await response.json();
          checkActive();
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
            checkActive();
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
              lastSyncedAt: new Date().toISOString(),
              undo:
                server.revision === pending.revision + 1
                  ? current.undo
                  : undefined,
              ...(current.seq === pending.seq
                ? {
                    state: server.state,
                    dirty: false,
                    foodTagsVersion: 1,
                    coachJournalVersion: 1,
                  }
                : { dirty: true }),
            };
          });
          publish(next);
          setStatus(
            next.conflict ? "conflict" : next.dirty ? "saved" : "synced",
          );
          setError("");
        };
        if (navigator.locks)
          await navigator.locks.request(
            `lift-sync:${accountId}`,
            { ifAvailable: true },
            async (lock) => {
              if (!lock)
                throw Error(
                  "Another tab is syncing. If this continues, close other Lift Journal tabs and reconnect. Your unsynced edits are kept on this device.",
                );
              await write();
            },
          );
        else await write();
      } catch (e) {
        if (controller.signal.aborted || !alive.current) return;
        setStatus(navigator.onLine ? "saved" : "offline");
        setError(e instanceof Error ? e.message : "Sync is unavailable.");
      } finally {
        if (syncing.current === controller) syncing.current = null;
        finishSync();
      }
    },
    [publish, onSessionInvalid],
  );
  useEffect(() => {
    alive.current = true;
    channel.current = new BroadcastChannel("lift-journal-sync");
    channel.current.onmessage = async (event) => {
      if (
        event.data?.type === "signed-out" &&
        event.data.accountId === account.current
      ) {
        onSessionInvalid();
        return;
      }
      if (event.data === account.current) {
        const value = await getLocal(account.current);
        if (alive.current && value.accountId === account.current)
          setRecord(value);
      }
    };
    // AccessGate verifies the server session before this hook is mounted.
    // A stored identity or offline copy can never grant access to the app.
    void getLocal(account.current)
      .then((local) => {
        if (!alive.current) return;
        publish(local);
        setStatus("saved");
        void sync();
      })
      .catch(() => {
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
    const online = () => void sync();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(() => void sync(), 15000);
    const mountedAccount = account.current;
    return () => {
      alive.current = false;
      syncing.current?.abort();
      void removeConfirmedLocal(mountedAccount).catch(() => {});
      try {
        localStorage.removeItem(`lift-agent:${mountedAccount}`);
        localStorage.removeItem(`lift-coach:${mountedAccount}`);
        localStorage.removeItem("lift-cloud:identity");
      } catch {}
      channel.current?.close();
      clearInterval(interval);
      if (retry.current) clearTimeout(retry.current);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync, publish, onSessionInvalid]);
  const update = useCallback(
    async (fn: (state: JournalState) => JournalState | void) => {
      try {
        const next = await changeLocal(account.current, (current) => {
          const before = structuredClone(current.state);
          const result = fn(current.state);
          current.state = result ?? current.state;
          current.state.updatedAt = new Date().toISOString();
          current.seq++;
          current.dirty = true;
          current.undo = {
            state: before,
            seq: current.seq,
            foodTagsVersion: current.foodTagsVersion,
            coachJournalVersion: current.coachJournalVersion,
          };
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
          undo: undefined,
          seq: current.seq + 1,
        };
      }),
    );
    await sync();
  };
  const signOut = async () => {
    const accountId = account.current;
    const work = async () => {
      const current = await getLocal(accountId);
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
      // Always lock the app immediately after server sign-out. Confirmed data
      // can be recovered from the account; do not leave it on a shared browser.
      channel.current?.postMessage({ type: "signed-out", accountId });
      onSessionInvalid();
      await removeConfirmedLocal(accountId);
      localStorage.removeItem("lift-cloud:identity");
      localStorage.removeItem(`lift-agent:${accountId}`);
      localStorage.removeItem(`lift-coach:${accountId}`);
      localStorage.removeItem(`lift-rest:${accountId}`);
    };
    if (navigator.locks)
      await navigator.locks.request(`lift-sync:${accountId}`, work);
    else if (syncing.current)
      throw Error("Wait for the current sync to finish, then sign out again.");
    else await work();
  };
  const undo = async () => {
    const next = await changeLocal(account.current, (current) => {
      if (!current.undo || current.undo.seq !== current.seq || current.conflict)
        throw Error("This change can no longer be undone safely.");
      const restored =
        current.undo.coachJournalVersion === 1
          ? coachStateForUndo(current.undo.state)
          : current.undo.state;
      return {
        ...current,
        state: {
          ...(current.undo.foodTagsVersion === 1
            ? foodStateForUndo(restored)
            : restored),
          updatedAt: new Date().toISOString(),
        },
        seq: current.seq + 1,
        dirty: true,
        undo: undefined,
      };
    });
    publish(next);
    setStatus(account.current === "guest" ? "local" : "saved");
    await sync();
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
    undo,
  };
}
