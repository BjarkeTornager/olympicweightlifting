import type { Workout } from "./model";

// How long a lifting session took. The clock starts at the first logged set,
// not when the draft was opened, which can be hours or a day earlier; the
// length is saved when the session is first finished, and an edit or later
// sets never stamp it again. Types only here: energy and the journal model
// both read it.

// Longer than five hours from the first set to Finish is a session left open,
// not one that long: it is saved untimed rather than as a length that never
// happened.
const LONGEST_TIMED_SESSION_MINUTES = 300;
const SHORTEST_TIMED_SESSION_MINUTES = 5;

const minutesBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 60000);

// Minutes between two times, kept only when they could be one session: a
// workout entered in one go after training spans no time at all.
export function timedMinutes(from?: string, to?: string) {
  if (!from || !to) return null;
  const minutes = minutesBetween(from, to);
  return minutes >= SHORTEST_TIMED_SESSION_MINUTES &&
    minutes <= LONGEST_TIMED_SESSION_MINUTES
    ? minutes
    : null;
}
// The length of a session finished now. Sets all logged in the last few
// minutes before Finish have no span of their own: the iPhone sending sets
// it saved without signal, or a session filled in at the end. Such a session
// runs from when its draft was opened, if that was within a session's
// length; a draft opened only to fill it in spans no time either.
export function finishedMinutes(draft: Workout, finishedAt: string) {
  const { firstSetAt, startedAt } = draft;
  const minutes = timedMinutes(firstSetAt ?? startedAt, finishedAt);
  if (minutes != null || !firstSetAt || !startedAt) return minutes;
  return minutesBetween(firstSetAt, finishedAt) < SHORTEST_TIMED_SESSION_MINUTES
    ? timedMinutes(startedAt, finishedAt)
    : null;
}
// A session's saved length, or for one finished before lengths were saved,
// the span from its first set (or the draft) to its finish.
export function sessionMinutes(w: Workout): number | null {
  if (w.durationMinutes !== undefined) return w.durationMinutes;
  return timedMinutes(w.firstSetAt ?? w.startedAt, w.finishedAt);
}
