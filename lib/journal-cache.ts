import type { JournalState } from "./model";

// Parsed journals of the last few accounts, each as it stood at one version
// (its revision and the row's version in the database), so reading it again
// skips loading and checking the whole document. Any write, by any means,
// gives the row a new version, so an entry is never served once it is out
// of date. Every read gets its own copy.
const entries = new Map<string, { version: string; state: JournalState }>();
const LIMIT = 8;

export function cachedJournal(userId: string, version: string) {
  const entry = entries.get(userId);
  if (entry?.version !== version) return undefined;
  entries.delete(userId);
  entries.set(userId, entry);
  return structuredClone(entry.state);
}

// Keeps this state, which the caller must not change or hand on afterwards.
export function rememberJournal(
  userId: string,
  version: string,
  state: JournalState,
) {
  entries.delete(userId);
  entries.set(userId, { version, state });
  for (const key of entries.keys()) {
    if (entries.size <= LIMIT) break;
    entries.delete(key);
  }
}
