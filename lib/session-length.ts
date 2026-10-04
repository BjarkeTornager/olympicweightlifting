import type { Workout } from "./model";

// How long a lifting session took. The clock starts at the first logged set,
// not when the draft was opened, which can be hours or a day earlier; the
// length is saved when the session is first finished, and an edit or later
// sets never stamp it again. Types only here: energy and the journal model
// both read it.

// Minutes between two times, kept only when they could be one session: a
// workout entered in one go after training spans no time at all.
export function timedMinutes(from?: string, to?: string) {
  if (!from || !to) return null;
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60000);
  return minutes >= 5 && minutes <= 1440 ? minutes : null;
}
// A session's saved length, or for one finished before lengths were saved,
// the span from its first set (or the draft) to its finish.
export function sessionMinutes(w: Workout): number | null {
  if (w.durationMinutes !== undefined) return w.durationMinutes;
  return timedMinutes(w.firstSetAt ?? w.startedAt, w.finishedAt);
}
