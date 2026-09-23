"use client";
import { TrackingSettings } from "../tracking-settings";
import { Invitations } from "../invitations";
import { privateFetch } from "@/lib/private-fetch";
import { useState } from "react";
import {
  Download,
  FileUp,
  LogIn,
  LogOut,
  RefreshCw,
} from "@/components/ui/icons";
import { backup, mergeImport, parseLegacyBackup } from "@/lib/domain";
import type { JournalState } from "@/lib/model";
import type { JournalController } from "../journal";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { downloadBackup } from "@/lib/download-backup";
export function SettingsView({
  trackingOpen = false,
  journal,
  onLogin,
  notify,
}: {
  trackingOpen?: boolean;
  journal: JournalController;
  onLogin: () => void;
  notify: (message: string) => void;
}) {
  const { state, identity, update } = journal;
  const [incoming, setIncoming] = useState<JournalState | null>(null),
    [importError, setImportError] = useState("");
  if (!state) return null;
  const prepare = (raw: unknown) => {
    try {
      const parsed = parseLegacyBackup(raw);
      mergeImport(state, parsed);
      setIncoming(parsed);
      setImportError("");
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "This backup could not be imported.",
      );
    }
  };
  return (
    <>
      <div className="page-heading compact">
        <div>
          <h1>Settings</h1>
          <p className="lead">
            Your profile, account and health journal backups.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <TrackingSettings journal={journal} initiallyOpen={trackingOpen} />
        {journal.auth.canInvite && <Invitations accountId={identity.id} />}
        <section className="panel">
          <h2>Your account</h2>
          <p>
            {identity
              ? "Signed in. Your journal syncs across devices."
              : "Training is saved on this device. Sign in to sync across devices."}
          </p>
          {identity ? (
            <div className="button-row">
              <Button variant="secondary" onClick={() => void journal.sync()}>
                <RefreshCw size={16} />
                Sync now
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void journal.signOut().catch((e) => notify(e.message))
                }
              >
                <LogOut size={16} />
                Sign out
              </Button>
            </div>
          ) : (
            <Button onClick={onLogin}>
              <LogIn size={18} />
              Sign in
            </Button>
          )}
          <p className="fine-print">
            {identity
              ? `Saved on device: ${new Date(state.updatedAt).toLocaleString()}`
              : "Export a backup before clearing browser data or changing devices."}
          </p>
          <p className="fine-print">
            {journal.record?.lastSyncedAt
              ? `Last cloud check: ${new Date(journal.record.lastSyncedAt).toLocaleString()}`
              : "Cloud sync has not been confirmed on this device."}
            {journal.record?.dirty ? " Changes are waiting to sync." : ""}
          </p>
          {identity && <DeviceSettings journal={journal} notify={notify} />}
          <a
            href="/privacy"
            className="fine-print underline underline-offset-4"
          >
            Privacy and your data
          </a>
        </section>
        <section className="panel">
          <h2>Athlete profile</h2>
          <form
            key={[
              identity?.id,
              state.profile.name,
              state.profile.bodyweight,
              state.profile.age,
            ].join("|")}
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              await update((s) => {
                s.profile = {
                  ...s.profile,
                  name: String(form.get("name")),
                  bodyweight: Number(form.get("bodyweight") || 0),
                  age: Number(form.get("age") || 0),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                };
              });
              notify("Profile saved.");
            }}
          >
            <label>
              Display name (optional)
              <input
                name="name"
                maxLength={120}
                defaultValue={state.profile.name ?? ""}
              />
            </label>
            <div className="form-grid">
              <label>
                Bodyweight · kg
                <input
                  name="bodyweight"
                  type="number"
                  min="0"
                  max="1000"
                  step="any"
                  defaultValue={state.profile.bodyweight || ""}
                />
              </label>
              <label>
                Age
                <input
                  name="age"
                  type="number"
                  min="0"
                  max="130"
                  step="1"
                  defaultValue={state.profile.age || ""}
                />
              </label>
            </div>
            <Button variant="secondary" type="submit">
              Save profile
            </Button>
          </form>
        </section>
        <section className="panel form-stack">
          <h2>Reading & rest</h2>
          <label className="check-label">
            <input
              type="checkbox"
              checked={Boolean(state.preferences.largeText)}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                void update((s) => {
                  s.preferences.largeText = checked;
                });
              }}
            />
            Larger text
          </label>
          <label>
            Default rest timer
            <select
              value={state.preferences.restSeconds ?? 90}
              onChange={(e) => {
                const seconds = Number(e.currentTarget.value);
                void update((s) => {
                  s.preferences.restSeconds = seconds;
                });
              }}
            >
              {[60, 90, 120, 180, 300].map((n) => (
                <option value={n} key={n}>
                  {n / 60} minutes
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            You can also use your browser’s text size and zoom settings.
          </p>
        </section>
        <section className="panel backup-panel">
          <span className="program-index">
            <Download size={24} />
          </span>
          <h2>Export backup</h2>
          <p className="muted">
            Export your strength training, cardio, food, health check-ins and
            unfinished workout in one portable JSON file.
          </p>
          <Button
            variant="secondary"
            onClick={() => downloadBackup(backup(state))}
          >
            <Download size={17} />
            Export backup
          </Button>
        </section>
        <section className="panel">
          <span className="program-index index-1">
            <FileUp size={24} />
          </span>
          <h2>Import backup</h2>
          <p className="muted">
            Import a Lift Journal backup from the original website or another
            device. You’ll review it before anything is saved.
          </p>
          <label className="file-button">
            Choose JSON backup
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  setImportError("Choose a backup smaller than 5 MB.");
                  return;
                }
                try {
                  prepare(JSON.parse(await file.text()));
                } catch {
                  setImportError("That file is not valid JSON.");
                }
                e.target.value = "";
              }}
            />
          </label>
          {importError && (
            <p className="error-text" role="alert">
              {importError}
            </p>
          )}
        </section>
        <section className="panel">
          <h2>App & device storage</h2>
          <p className="muted">
            On iPhone, open this site in Safari and choose Share → Add to Home
            Screen. An online session check is required to open your journal.
            Device storage keeps pending edits safe until they sync.
          </p>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const registration =
                  await navigator.serviceWorker?.getRegistration();
                await registration?.update();
                if (registration?.waiting) {
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                  registration.waiting.postMessage({ type: "ACTIVATE" });
                } else location.reload();
              } catch {
                notify("Reconnect to check for an app update.");
              }
            }}
          >
            <RefreshCw size={17} />
            Refresh app
          </Button>
        </section>
        <section className="panel">
          <h2>Privacy</h2>
          <p className="muted">
            Your training stays on this device until you sign in and sync.
            Signed-in journals are stored privately in PostgreSQL. Technique
            videos connect to YouTube only when you open them.
          </p>
          <p className="muted">
            Keep your own exports for long-term recovery. Contact the app owner
            to request account deletion during the private pilot.
          </p>
        </section>
      </div>
      <Dialog
        open={Boolean(incoming)}
        onOpenChange={(open) => {
          if (!open) setIncoming(null);
        }}
        title="Review your backup"
        description="Existing sessions with identical IDs are skipped. Conflicting versions are stopped for review. Importing keeps your current journal and adds missing sessions."
      >
        <div className="import-counts">
          <strong>
            {incoming?.sessions.length ?? 0}
            <span>sessions</span>
          </strong>
          <strong>
            {incoming?.sessions.reduce(
              (n, w) => n + w.exercises.reduce((n, e) => n + e.sets.length, 0),
              0,
            ) ?? 0}
            <span>sets</span>
          </strong>
          <strong>
            {incoming?.activeWorkout ? 1 : 0}
            <span>active draft</span>
          </strong>
        </div>
        <p className="muted">
          {state.sessions.length
            ? "Your current profile and PRs will be kept."
            : "An empty journal also takes the backup’s profile and personal bests."}
        </p>
        <div className="button-row">
          <Button
            onClick={async () => {
              if (!incoming) return;
              try {
                await update((current) => mergeImport(current, incoming));
                setIncoming(null);
                notify("Backup imported and saved on this device.");
              } catch (e) {
                setImportError(
                  e instanceof Error ? e.message : "Import failed.",
                );
                setIncoming(null);
              }
            }}
          >
            Import backup
          </Button>
          <Button variant="secondary" onClick={() => setIncoming(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function DeviceSettings({
  journal,
  notify,
}: {
  journal: JournalController;
  notify: (s: string) => void;
}) {
  const [clear, setClear] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <div className="device-settings">
      <p className="fine-print">
        Sign-out clears the confirmed copy after syncing. Unsynced edits stay
        locked until you sign in again.
      </p>
      <div className="button-row">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await privateFetch("/api/devices/revoke", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Journal-Account": journal.identity?.id ?? "",
                },
                body: "{}",
              });
              if (!r.ok)
                throw Error(
                  "Could not sign out other devices. Try again online.",
                );
              notify(
                "Other sessions signed out. Those devices must sign in again to open the journal.",
              );
            } catch (e) {
              notify(
                e instanceof Error ? e.message : "Could not update sessions.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out other devices
        </Button>
        <Button variant="ghost" onClick={() => setClear(true)}>
          Sign out & clear this device
        </Button>
      </div>
      <Dialog
        open={clear}
        onOpenChange={setClear}
        title="Clear the offline copy?"
        description="Your synced journal stays in your account. This browser’s account journal, chat cache and timer will be removed. Pending changes must sync first."
      >
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await journal.signOut();
              setClear(false);
            } catch (e) {
              notify(e instanceof Error ? e.message : "Sign-out failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out & clear
        </Button>
      </Dialog>
    </div>
  );
}
