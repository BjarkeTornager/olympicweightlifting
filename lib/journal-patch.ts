import { z } from "zod";
import { jsonEqual } from "./json";

// A save as the website sends it: only what differs from the server's copy
// of the journal, so a save stays small however long the journal grows.
// Lists of records with ids (meals, sessions, drinks and the like) change
// record by record; anything else is set whole where it differs.
const key = z
  .string()
  .max(200)
  .refine(
    (k) => !["__proto__", "constructor", "prototype"].includes(k),
    "Not a journal field",
  );
const path = z.array(key).max(12);
const id = z.string().min(1).max(200);
export const journalPatchSchema = z
  .array(
    z.discriminatedUnion("op", [
      z.object({ op: z.literal("set"), path: path.min(1), value: z.unknown() }),
      z.object({ op: z.literal("unset"), path: path.min(1) }),
      z.object({
        op: z.literal("items"),
        path: path.min(1),
        remove: z.array(id).optional(),
        put: z.array(z.looseObject({ id })).optional(),
        // The full order, only when it is not the old one with new records
        // at the end.
        order: z.array(id).optional(),
      }),
    ]),
  )
  .max(20000);
export type JournalPatch = z.infer<typeof journalPatchSchema>;

// The changes do not fit the journal they are applied to: it is not the
// copy they were made from.
export class PatchMismatch extends Error {}

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  !!value && typeof value === "object" && !Array.isArray(value);
// The ids of a list of records, or undefined when it is not one.
function recordIds(list: unknown[]) {
  const ids = new Set<string>();
  for (const item of list) {
    if (!isFields(item) || typeof item.id !== "string" || ids.has(item.id))
      return undefined;
    ids.add(item.id);
  }
  return ids;
}

// What turns `before` into `after`.
export function diffJournal(
  before: unknown,
  after: unknown,
  at: string[] = [],
  patch: JournalPatch = [],
): JournalPatch {
  if (isFields(before) && isFields(after)) {
    for (const k of Object.keys(before))
      if (before[k] !== undefined && after[k] === undefined)
        patch.push({ op: "unset", path: [...at, k] });
    for (const k of Object.keys(after)) {
      if (after[k] === undefined) continue;
      if (before[k] === undefined)
        patch.push({ op: "set", path: [...at, k], value: after[k] });
      else diffJournal(before[k], after[k], [...at, k], patch);
    }
    return patch;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const old = recordIds(before),
      now = recordIds(after);
    if (old && now && (old.size || now.size)) {
      const was = new Map(
        (before as Fields[]).map((item) => [item.id as string, item]),
      );
      const remove = [...old].filter((i) => !now.has(i));
      const put = (after as Fields[]).filter(
        (item) => !jsonEqual(was.get(item.id as string), item),
      ) as { id: string }[];
      // Applying keeps the kept records in their order and adds new ones at
      // the end; the order goes with the change only when that differs.
      const kept = [...old].filter((i) => now.has(i));
      const added = [...now].filter((i) => !old.has(i));
      const order = [...now];
      const moved = [...kept, ...added].some((i, n) => i !== order[n]);
      if (remove.length || put.length || moved)
        patch.push({
          op: "items",
          path: at,
          ...(remove.length ? { remove } : {}),
          ...(put.length ? { put } : {}),
          ...(moved ? { order } : {}),
        });
      return patch;
    }
  }
  if (!jsonEqual(before, after)) {
    if (!at.length) throw Error("A journal is a set of fields.");
    patch.push({ op: "set", path: at, value: after });
  }
  return patch;
}

// The journal with the changes made, in place.
export function applyJournalPatch<T>(journal: T, patch: JournalPatch): T {
  const field = (at: string[]) => {
    let value: unknown = journal;
    for (const k of at) {
      if (!isFields(value) || !Object.hasOwn(value, k))
        throw new PatchMismatch(`No ${at.join(".")} in this journal.`);
      value = value[k];
    }
    return value;
  };
  for (const change of patch) {
    if (change.op === "items") {
      const list = field(change.path);
      if (!Array.isArray(list) || !recordIds(list))
        throw new PatchMismatch(`${change.path.join(".")} is not a list.`);
      const removed = new Set(change.remove ?? []);
      const next = (list as Fields[]).filter(
        (item) => !removed.has(item.id as string),
      );
      const index = new Map(next.map((item, n) => [item.id as string, n]));
      for (const item of change.put ?? []) {
        const n = index.get(item.id);
        if (n === undefined) {
          index.set(item.id, next.length);
          next.push(item);
        } else next[n] = item;
      }
      let result = next;
      if (change.order) {
        const byId = new Map(next.map((item) => [item.id as string, item]));
        if (
          change.order.length !== next.length ||
          new Set(change.order).size !== next.length ||
          change.order.some((i) => !byId.has(i))
        )
          throw new PatchMismatch(
            `${change.path.join(".")} has other records.`,
          );
        result = change.order.map((i) => byId.get(i)!);
      }
      (field(change.path.slice(0, -1)) as Fields)[change.path.at(-1)!] = result;
      continue;
    }
    const parent = field(change.path.slice(0, -1));
    const name = change.path.at(-1)!;
    if (!isFields(parent))
      throw new PatchMismatch(`No ${change.path.join(".")} in this journal.`);
    if (change.op === "set") parent[name] = change.value;
    else delete parent[name];
  }
  return journal;
}
