import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { emptyJournal } from "./domain";
import type { Identity, JournalState, Snapshot } from "./model";
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
const database = () =>
  (connection ??= openDB<LocalDB>("lift-journal-cloud", 1, {
    upgrade(db) {
      db.createObjectStore("journals", { keyPath: "accountId" });
    },
  }));
export async function getLocal(accountId: string) {
  const db = await database();
  return (
    (await db.get("journals", accountId)) ?? {
      accountId,
      state: emptyJournal(),
      revision: 0,
      seq: 0,
      dirty: false,
    }
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
  const result = fn(structuredClone(old));
  await tx.store.put(result);
  await tx.done;
  return result;
}
export function cachedIdentity(): Identity | null {
  try {
    return JSON.parse(localStorage.getItem("lift-cloud:identity") ?? "null");
  } catch {
    return null;
  }
}
export function cacheIdentity(value: Identity | null) {
  if (value) localStorage.setItem("lift-cloud:identity", JSON.stringify(value));
  else localStorage.removeItem("lift-cloud:identity");
}
export async function removeLocal(accountId: string) {
  await (await database()).delete("journals", accountId);
}
