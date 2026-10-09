import type { JournalState } from "./model";
import {
  formatSleepDuration,
  offsetDate,
  sleepAverage,
  type Checkin,
} from "./health";

// How much sleep a night calls for (CDC, AASM, Sundhedsstyrelsen): at least
// 7 hours for adults, 8 to 10 at 13-17 and 9 to 12 at 6-12. Under 6 hours the
// wording is firmer. The thresholds for speaking up are design choices, not
// clinical cut-offs.
export const ADULT_SLEEP_HOURS = 7;
export const TEEN_SLEEP_HOURS = 8;
export const CHILD_SLEEP_HOURS = 9;
export const VERY_SHORT_SLEEP_HOURS = 6;

type Night = Checkin & { sleepHours: number };

function nights(state: JournalState, from: string, to: string): Night[] {
  return state.health.checkins
    .filter(
      (c): c is Night => c.sleepHours != null && c.date >= from && c.date <= to,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

const mean = (values: Night[]) =>
  values.reduce((sum, c) => sum + c.sleepHours, 0) / values.length;

// Where a night's sleep came from, so like is compared with like: what the
// athlete reports runs higher than what a tracker measures, and trackers
// differ from each other.
export function sleepSource(c: Checkin) {
  if (!c.sleepImport) return "reported";
  return c.sleepImport.source
    ? `apple-health:${c.sleepImport.source}`
    : "apple-health";
}

function age(state: JournalState) {
  const value = state.profile.body?.age || state.profile.age;
  return value > 0 ? value : null;
}

// What the athlete's age calls for, with the recommended range for a child
// or teenager. An age under 6 is more likely a slip than a lifter's, so it
// counts as unknown, as does no age: the adult guidance.
function sleepNeed(state: JournalState) {
  const years = age(state);
  if (years != null && years >= 6 && years < 13)
    return { hours: CHILD_SLEEP_HOURS, range: "9 to 12 hours" };
  if (years != null && years >= 13 && years < 18)
    return { hours: TEEN_SLEEP_HOURS, range: "8 to 10 hours" };
  return { hours: ADULT_SLEEP_HOURS, range: null };
}

// Short sleep over the last two weeks: at least five logged nights whose
// average is under what the athlete's age calls for. Missing nights are
// unknown, not short.
export function shortSleep(state: JournalState, date: string) {
  const logged = nights(state, offsetDate(date, -13), date);
  const averageHours = sleepAverage(logged.map((c) => c.sleepHours));
  const need = sleepNeed(state);
  if (averageHours == null || averageHours >= need.hours) return null;
  return {
    averageHours,
    nights: logged.length,
    // Under 18: "9 to 12 hours" or "8 to 10 hours"; null for adults.
    recommended: need.range,
    need: need.hours,
    veryShort: averageHours < VERY_SHORT_SLEEP_HOURS,
  };
}
export type ShortSleep = NonNullable<ReturnType<typeof shortSleep>>;

// The last three nights, when all three are logged, and how they compare.
// "drop": at least an hour under four or more nights of the week before,
// from the same source. "short": under 6 hours on average, whatever the week
// before was.
export function sleepChange(state: JournalState, date: string) {
  const from = offsetDate(date, -2);
  const recent = nights(state, from, date);
  if (recent.length !== 3) return null;
  const recentHours = mean(recent);
  const source = sleepSource(recent[0]);
  if (recent.every((c) => sleepSource(c) === source)) {
    const baseline = nights(
      state,
      offsetDate(date, -9),
      offsetDate(date, -3),
    ).filter((c) => sleepSource(c) === source);
    if (baseline.length >= 4 && mean(baseline) - recentHours >= 1)
      return {
        kind: "drop" as const,
        from,
        recentHours,
        baselineHours: mean(baseline),
        baselineNights: baseline.length,
      };
  }
  if (recentHours < VERY_SHORT_SLEEP_HOURS)
    return { kind: "short" as const, from, recentHours };
  return null;
}

const need = (short: ShortSleep) =>
  short.recommended
    ? `the ${short.recommended} recommended at your age`
    : "the 7 hours or more most adults need";

// Coach's opening on short sleep over the last two weeks, gentler while the
// average is 6 hours or more.
export function sleepShortOpening(short: ShortSleep) {
  const observation = `Your ${short.nights} logged nights from the last two weeks average ${formatSleepDuration(short.averageHours)}`;
  return short.veryShort
    ? {
        id: "sleep-short",
        title: "Your sleep has been short for a while.",
        observation: `${observation}, well under ${need(short)}.`,
        invitation:
          "Sleep this short holds back strength, recovery and mood. Let’s look at what is getting in the way. If you struggle to fall or stay asleep, snore loudly or feel very sleepy in the day, it is worth seeing your GP.",
        prompt:
          "My sleep has been very short lately. Help me work out what is getting in the way, and whether I should talk to a doctor about it.",
      }
    : {
        id: "sleep-short",
        title: "Your nights have been on the short side.",
        observation: `${observation}, under ${need(short)}.`,
        invitation:
          "There’s no need to chase a number. If it feels doable, we could find one small change that gives you more time asleep.",
        prompt:
          "My sleep has been on the short side lately. Help me find one realistic change that gives me more time asleep.",
      };
}

// For the voice coach, which otherwise has only last night to go on: short
// sleep the journal shows, decided here rather than left to the model. One
// night under 6 hours on its own is about today's training, not health.
export function shortSleepNote(state: JournalState, date: string) {
  const change = sleepChange(state, date);
  const short = shortSleep(state, date);
  const lastNight = state.health.checkins.find(
    (c) => c.date === date,
  )?.sleepHours;
  const notes = [
    change && change.recentHours < VERY_SHORT_SLEEP_HOURS
      ? `the last three nights average ${formatSleepDuration(change.recentHours)}`
      : lastNight != null && lastNight < VERY_SHORT_SLEEP_HOURS
        ? `last night was ${formatSleepDuration(lastNight)}: one night that short can take the edge off today's training, so a light word about that fits, not a health worry`
        : "",
    short
      ? `the ${short.nights} logged nights of the last two weeks average ${formatSleepDuration(short.averageHours)}, under ${short.recommended ? `the ${short.recommended} recommended at their age` : "the 7 hours or more adults need"}`
      : "",
  ].filter(Boolean);
  return notes.length
    ? `${notes.join("; ")}.${short?.veryShort ? " Well under: a gentle word about seeing a GP fits if they also struggle to sleep, snore loudly or feel very sleepy in the day." : ""}`
    : null;
}
