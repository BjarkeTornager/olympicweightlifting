import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { emptyJournal } from "./domain";
import type { JournalState, Snapshot } from "./model";
import { nutritionSchema } from "./nutrition";
import { healthSchema } from "./health";
export type LocalRecord = Snapshot & {
  accountId: string;
  seq: number;
  dirty: boolean;
  lastSyncedAt?: string;
  undo?: { state: JournalState; seq: number };
  pending?: {
    mutationId: string;
    revision: number;
    state: JournalState;
    seq: number;
  };
  conflict?: Snapshot;
};
interface LocalDB extends DBSchema {
  journals: { key: string; value: LocalRecord };
}
let connection: Promise<IDBPDatabase<LocalDB>> | undefined;
function upgradeLocal(record: LocalRecord): LocalRecord {
  const upgrade = (state: JournalState) => ({
    ...state,
    nutrition: nutritionSchema.parse(state.nutrition ?? {}),
    health: healthSchema.parse(state.health ?? {}),
  });
  return {
    ...record,
    state: upgrade(record.state),
    ...(record.undo
      ? { undo: { ...record.undo, state: upgrade(record.undo.state) } }
      : {}),
    ...(record.conflict
      ? {
          conflict: {
            ...record.conflict,
            state: upgrade(record.conflict.state),
          },
        }
      : {}),
  };
}
const database = () =>
  (connection ??= openDB<LocalDB>("lift-journal-cloud", 1, {
    upgrade(db) {
      db.createObjectStore("journals", { keyPath: "accountId" });
    },
  }));
export async function getLocal(accountId: string) {
  const db = await database();
  return upgradeLocal(
    (await db.get("journals", accountId)) ?? {
      accountId,
      state: emptyJournal(),
      revision: 0,
      seq: 0,
      dirty: false,
    },
  );
}
export async function changeLocal(
  accountId: string,
  fn: (record: LocalRecord) => LocalRecord,
) {
  const db = await database();
  const tx = db.transaction("journals", "readwrite");
  const old = (await tx.store.get(accountId)) ?? {
    accountId,
    state: emptyJournal(),
    revision: 0,
    seq: 0,
    dirty: false,
  };
  const result = upgradeLocal(fn(upgradeLocal(structuredClone(old))));
  await tx.store.put(result);
  await tx.done;
  return result;
}
export async function removeLocal(accountId: string) {
  await (await database()).delete("journals", accountId);
}

export async function removeConfirmedLocal(accountId: string) {
  const db = await database();
  const tx = db.transaction("journals", "readwrite");
  const current = await tx.store.get(accountId);
  // Never discard an unsynced edit during expiry or a concurrent sign-out.
  if (current && !current.dirty && !current.pending)
    await tx.store.delete(accountId);
  await tx.done;
}
