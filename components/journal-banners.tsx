"use client";
import { Undo2 } from "@/components/ui/icons";
import { backup } from "@/lib/domain";
import { downloadBackup } from "@/lib/download-backup";
import type { JournalController } from "./journal";
import { Button } from "./ui/button";

// When the device last saved and synced, with Undo for the latest change.
export function SaveDetail({
  journal,
  compact,
  onMessage: setMessage,
}: {
  journal: JournalController;
  // Training shows only the save state, to keep the workout uncluttered.
  compact: boolean;
  onMessage: (message: string) => void;
}) {
  const { state, identity } = journal;
  if (!state || !(journal.record?.dirty || journal.record?.undo)) return null;
  return (
    <div className="save-detail">
      <span>
        {compact ? (
          journal.record?.dirty ? (
            "Changes waiting to sync"
          ) : (
            "Last change saved"
          )
        ) : (
          <>
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
          </>
        )}
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
  );
}

// Offers both copies for export before the athlete picks which one to keep.
export function SyncConflictNotice({
  journal,
}: {
  journal: JournalController;
}) {
  const { state } = journal;
  if (!journal.record?.conflict) return null;
  return (
    <div className="notice warning">
      <div>
        <strong>Another device has newer changes.</strong>
        <p>
          Your work is still saved here. Export both copies before choosing
          which version to sync.
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
  );
}
