import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkout,
  days,
  emptyJournal,
  finishWorkout,
  hasLoggedSet,
  startClock,
} from "../lib/domain";
import { saveCardio, type CardioEntry } from "../lib/cardio";
import {
  bodyweightKg,
  burnText,
  burnedLines,
  burnedToday,
  cardioBurn,
  dayBurn,
  LIFTING_NET_KCAL_PER_KG_HOUR,
  strengthBurn,
} from "../lib/energy";
import { dayForCoach, describeDay } from "../lib/journal-summary";
import type { JournalState, Workout } from "../lib/model";

const date = "2026-09-28";

function journal(weight = 80) {
  const s = emptyJournal();
  s.profile.bodyweight = weight;
  return s;
}
const activity = (s: JournalState, entry: Record<string, unknown>) =>
  saveCardio(s, { date, ...entry }, date);
function aged(s: JournalState, age: number, sex: "male" | "female" = "male") {
  s.profile.body = { ...(s.profile.body ?? {}), age, sex } as never;
  return s;
}

test("a recorded figure is an estimate too, marked with where it came from", () => {
  const s = journal();
  // Typed in: kept as given, on every screen and for Coach alike.
  const e = activity(s, {
    activity: "rowing",
    durationSeconds: 900,
    caloriesKcal: 88,
  });
  assert.equal(e.caloriesSource, "entered");
  assert.deepEqual(cardioBurn(s, e), {
    kcal: 88,
    estimated: true,
    method: "entered",
  });
  assert.equal(burnText(cardioBurn(s, e)), "~88 kcal · as entered");
  // Saved before sources were kept: it can't be told apart.
  const older = { ...e, caloriesSource: undefined };
  assert.equal(burnText(cardioBurn(s, older)), "~88 kcal · as recorded");
  // From Apple Health: the watch's own estimate, to the nearest 10 kcal.
  const watch = {
    ...activity(s, {
      activity: "running",
      durationSeconds: 3000,
      caloriesKcal: 612,
    }),
    caloriesSource: "apple-health" as const,
  };
  assert.deepEqual(cardioBurn(s, watch), {
    kcal: 610,
    estimated: true,
    method: "watch",
  });
  assert.equal(burnText(cardioBurn(s, watch)), "~610 kcal · watch");
  // Read from a photo when Coach logs it from one.
  const photo = saveCardio(
    s,
    { date, activity: "cycling", durationSeconds: 1800, caloriesKcal: 240 },
    date,
    undefined,
    "photo",
  );
  assert.equal(burnText(cardioBurn(s, photo)), "~240 kcal · from the photo");
});

test("an entry's calories keep their source until the athlete changes them", () => {
  const s = journal();
  const watch = activity(s, {
    activity: "running",
    durationSeconds: 3000,
    caloriesKcal: 612,
  });
  s.cardio.sessions = [{ ...watch, caloriesSource: "apple-health" }];
  // A new title keeps the watch's figure as the watch's.
  const renamed = saveCardio(s, { title: "Long run" }, date, watch.id);
  assert.equal(renamed.caloriesSource, "apple-health");
  // A typed correction is the athlete's own.
  const corrected = saveCardio(s, { caloriesKcal: 500 }, date, watch.id);
  assert.equal(corrected.caloriesSource, "entered");
  assert.equal(burnText(cardioBurn(s, corrected)), "~500 kcal · as entered");
  // Cleared: no figure, so no source.
  const cleared = saveCardio(s, { caloriesKcal: null }, date, watch.id);
  assert.equal(cleared.caloriesSource, undefined);
});

test("a recorded 0 for a workout of five minutes or more is a gap, not a reading", () => {
  const s = journal(80);
  const long = activity(s, {
    activity: "walking",
    durationSeconds: 1800,
    caloriesKcal: 0,
  });
  assert.equal(cardioBurn(s, long)?.method, "activity and duration");
  const short = activity(s, {
    activity: "walking",
    durationSeconds: 120,
    caloriesKcal: 0,
  });
  assert.equal(cardioBurn(s, short)?.kcal, 0);
});

test("the app's estimates are net of rest, to the nearest 10 kcal", () => {
  const s = journal(80);
  // A stair machine is 9.3 METs, 8.3 above rest: 8.3 × 80 kg × 1/3 h.
  const machine = activity(s, {
    activity: "other",
    title: "StairMaster",
    durationSeconds: 1200,
  });
  assert.deepEqual(cardioBurn(s, machine), {
    kcal: 220,
    estimated: true,
    method: "activity and duration",
  });
  assert.equal(burnText(cardioBurn(s, machine)), "~220 kcal est.");
  // Running with no distance: 9.8 METs, so 8.8 × 80 × 0.5 h.
  const run = activity(s, { activity: "running", durationSeconds: 1800 });
  assert.equal(cardioBurn(s, run)?.kcal, 350);
  // Lifting: 4 kcal per kg an hour above rest, so 600 for 100 kg over 90 min.
  assert.equal(LIFTING_NET_KCAL_PER_KG_HOUR, 4);
});

test("Apple Health's other workouts and Danish titles get their own values", () => {
  const s = journal(100);
  const kcal = (title: string) =>
    cardioBurn(
      s,
      activity(s, { activity: "other", title, durationSeconds: 3600 }),
    )?.kcal;
  // Net per hour at 100 kg: (MET - 1) × 100.
  assert.equal(kcal("Pilates"), 180);
  assert.equal(kcal("Flexibility"), 130);
  assert.equal(kcal("Cooldown"), 130);
  assert.equal(kcal("Core Training"), 280);
  assert.equal(kcal("Mixed Cardio"), 630);
  assert.equal(kcal("Jump Rope"), 1000);
  assert.equal(kcal("Football"), 600);
  assert.equal(kcal("Tennis"), 580);
  assert.equal(kcal("Badminton"), 450);
  assert.equal(kcal("Cross-Country Skiing"), 750);
  assert.equal(kcal("Skiing"), 530);
  assert.equal(kcal("Snowboarding"), 530);
  assert.equal(kcal("Golf"), 330);
  assert.equal(kcal("Dance"), 400);
  assert.equal(kcal("Functional Strength Training"), 400);
  assert.equal(kcal("Martial Arts"), 650);
  assert.equal(kcal("Climbing"), 600);
  assert.equal(kcal("Cross Training"), 500);
  assert.equal(kcal("Boxing"), 600);
  // Real stairs are not a stair machine.
  assert.equal(kcal("Stair Climbing"), 830);
  assert.equal(kcal("Stairs"), 580);
  // Danish titles.
  assert.equal(kcal("Styrketræning"), 400);
  assert.equal(kcal("Cirkeltræning"), 700);
  assert.equal(kcal("Udstrækning"), 130);
  assert.equal(kcal("Mobilitet"), 130);
  assert.equal(kcal("Spinning"), 600);
  assert.equal(kcal("Trappeløb"), 580);
  assert.equal(kcal("Workout"), 400);
});

test("cycling speeds smooth between bands instead of jumping at 16 km/h", () => {
  const s = journal(80);
  const ride = (kmh: number) =>
    cardioBurn(
      s,
      activity(s, {
        activity: "cycling",
        durationSeconds: 3600,
        distanceKm: kmh,
      }),
    )!.kcal;
  const below = ride(15.9),
    above = ride(16.1);
  assert.ok(above - below <= 20, `${below} then ${above}`);
  assert.ok(
    ride(12) < ride(17.5) && ride(17.5) < ride(21) && ride(21) < ride(25),
  );
  // The leisure value below the bands, 4 METs.
  assert.equal(ride(10), 240);
});

test("walking at half of maximum heart rate uses the activity value, not Keytel", () => {
  const s = aged(journal(80), 35);
  // 208 - 0.7 × 35 = 183.5 bpm maximum; 92 bpm is half of it.
  const walk = activity(s, {
    activity: "walking",
    durationSeconds: 3600,
    averageHeartRate: 92,
  });
  assert.deepEqual(cardioBurn(s, walk), {
    kcal: 200,
    estimated: true,
    method: "activity and duration",
  });
});

test("Keytel is used only for steady cardio in its range of heart rate and age", () => {
  const s = aged(journal(80), 35);
  const ride = (entry: Record<string, unknown>) =>
    cardioBurn(
      s,
      activity(s, {
        activity: "cycling",
        durationSeconds: 1800,
        averageHeartRate: 140,
        ...entry,
      }),
    )!;
  const steady = ride({});
  assert.equal(steady.method, "heart rate");
  // Gross 403 kcal from Keytel, less 40 kcal of rest.
  assert.equal(steady.kcal, 360);
  // Above 90 % of maximum heart rate (183.5 bpm): out of range.
  const fast = { averageHeartRate: 168, distanceKm: 15 };
  assert.equal(ride(fast).method, "activity and duration");
  // A recorded maximum above the age formula widens the range.
  assert.equal(ride({ ...fast, maxHeartRate: 195 }).method, "heart rate");
  // Far from the table value, heart rate is not believed.
  assert.equal(
    ride({ maxHeartRate: 195, averageHeartRate: 168 }).method,
    "activity and duration",
  );
  // Under 10 minutes is not steady work.
  assert.equal(ride({ durationSeconds: 540 }).method, "activity and duration");
  // Lifting, or anything else, never uses heart rate.
  assert.equal(
    cardioBurn(
      s,
      activity(s, {
        activity: "other",
        title: "Strength Training",
        durationSeconds: 3600,
        averageHeartRate: 140,
      }),
    )?.method,
    "activity and duration",
  );
  // Ages 46-65 are an extrapolation, and said to be; older or younger, none.
  aged(s, 50);
  assert.equal(
    ride({ averageHeartRate: 130 }).method,
    "heart rate, extrapolated beyond age 45",
  );
  aged(s, 70);
  assert.equal(ride({ averageHeartRate: 120 }).method, "activity and duration");
  aged(s, 16);
  assert.equal(ride({}).method, "activity and duration");
  // Sex unknown: no heart-rate equation.
  s.profile.body = { ...s.profile.body!, age: 35, sex: "unspecified" };
  assert.equal(ride({}).method, "activity and duration");
});

test("no bodyweight, or an implausible duration, means no estimate rather than a guess", () => {
  const empty = emptyJournal();
  const walk = saveCardio(
    empty,
    { date, activity: "walking", durationSeconds: 1800 },
    date,
  );
  assert.equal(cardioBurn(empty, walk), null);
  assert.equal(burnText(null), "");
  const s = journal(80);
  // Over six hours is more likely a typing slip than one activity.
  assert.equal(
    cardioBurn(
      s,
      activity(s, { activity: "walking", durationSeconds: 7 * 3600 }),
    ),
    null,
  );
  // Over 3,000 kcal from a table value is not believed either.
  const heavy = journal(200);
  assert.equal(
    cardioBurn(
      heavy,
      activity(heavy, { activity: "running", durationSeconds: 5 * 3600 }),
    ),
    null,
  );
});

test("the weight for a date is the latest check-in from the 30 days before it", () => {
  const s = emptyJournal();
  s.profile.body = { weightKg: 95 } as never;
  assert.equal(bodyweightKg(s, date), 95);
  s.profile.bodyweight = 90;
  assert.equal(bodyweightKg(s, date), 90, "Settings before goal setup");
  s.health.checkins.push(
    { date: "2026-08-20", bodyweight: 70 } as never,
    { date: "2026-09-10", bodyweight: 86 } as never,
    { date: "2026-09-30", bodyweight: 84 } as never,
  );
  assert.equal(bodyweightKg(s, date), 86);
  // A weigh-in more than 30 days old no longer counts.
  assert.equal(bodyweightKg(s, "2026-10-15"), 84);
  assert.equal(bodyweightKg(s, "2026-09-15"), 86);
  assert.equal(bodyweightKg(s, "2026-08-25"), 70);
  assert.equal(bodyweightKg(s, "2026-10-31"), 90);
});

function lift(s: JournalState, opened: string): Workout {
  const w = createWorkout(s, days[0], date);
  w.startedAt = opened;
  return w;
}
const at = (iso: string) => new Date(iso);
function logFirstSet(w: Workout) {
  const set = w.exercises[0].sets[0];
  set.weight = "60";
  set.reps = "2";
  set.result = "success";
  set.logged = true;
}

test("a timed strength session is estimated; an open-ended one is not", () => {
  const s = journal(100);
  const w = {
    id: crypto.randomUUID(),
    date,
    title: "Snatch day",
    exercises: [],
    startedAt: "2026-09-28T16:00:00.000Z",
    finishedAt: "2026-09-28T17:30:00.000Z",
  } as unknown as Workout;
  // 4 kcal per kg an hour above rest × 100 kg × 1.5 h.
  assert.equal(strengthBurn(s, w)?.kcal, 600);
  assert.equal(burnText(strengthBurn(s, w)), "~600 kcal est.");
  assert.equal(
    strengthBurn(s, { ...w, finishedAt: "2026-09-29T09:00:00.000Z" }),
    null,
  );
  assert.equal(strengthBurn(s, { ...w, finishedAt: undefined }), null);
  // A saved length wins over the times.
  assert.equal(strengthBurn(s, { ...w, durationMinutes: 60 })?.kcal, 400);
  assert.equal(strengthBurn(s, { ...w, durationMinutes: null }), null);
});

test("a session's clock starts at its first set, not when the draft was opened", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-09-28T16:00:00Z") });
  const s = journal(88);
  // Opened the evening before.
  s.activeWorkout = lift(s, "2026-09-27T20:00:00.000Z");
  const started = hasLoggedSet(s.activeWorkout);
  logFirstSet(s.activeWorkout!);
  startClock(s.activeWorkout!, started);
  assert.equal(s.activeWorkout!.firstSetAt, "2026-09-28T16:00:00.000Z");
  t.mock.timers.setTime(at("2026-09-28T17:30:00Z").getTime());
  const done = finishWorkout(s);
  const session = done.sessions[0];
  assert.equal(session.durationMinutes, 90);
  // 4 × 88 kg × 1.5 h is 528, to the nearest 10.
  assert.equal(strengthBurn(done, session)?.kcal, 530);
});

test("an edit two hours later does not change a session's length", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-09-28T17:30:00Z") });
  const s = journal(88);
  s.activeWorkout = lift(s, "2026-09-28T16:00:00.000Z");
  logFirstSet(s.activeWorkout);
  const first = finishWorkout(s);
  const session = first.sessions[0];
  assert.equal(session.durationMinutes, 90);
  // Edited from History at 19:45: a draft copy that finishes again.
  t.mock.timers.setTime(at("2026-09-28T19:45:00Z").getTime());
  first.activeWorkout = {
    ...structuredClone(session),
    id: crypto.randomUUID(),
    editingSessionId: session.id,
  };
  first.activeWorkout.exercises[0].sets[0].reps = "3";
  const edited = finishWorkout(first);
  assert.equal(edited.sessions.length, 1);
  assert.equal(edited.sessions[0].durationMinutes, 90);
  assert.equal(edited.sessions[0].finishedAt, session.finishedAt);
  assert.equal(strengthBurn(edited, edited.sessions[0])?.kcal, 530);
  // A session saved before lengths were keeps the span it had.
  const legacy = structuredClone(session);
  delete legacy.durationMinutes;
  legacy.firstSetAt = undefined;
  first.sessions = [legacy];
  first.activeWorkout = {
    ...structuredClone(legacy),
    id: crypto.randomUUID(),
    editingSessionId: legacy.id,
  };
  assert.equal(finishWorkout(first).sessions[0].durationMinutes, 90);
});

test("Coach adding sets later keeps the length; merges add the entries' lengths", async (t) => {
  const { prepareWorkoutProgress, prepareSession } =
    await import("../lib/agent/prepare-workouts");
  const { mergeWorkoutSessions } = await import("../lib/workout-continuity");
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-09-28T17:30:00Z") });
  const s = journal(88);
  s.activeWorkout = lift(s, "2026-09-28T16:00:00.000Z");
  logFirstSet(s.activeWorkout);
  const done = finishWorkout(s);
  const id = done.sessions[0].id;
  t.mock.timers.setTime(at("2026-09-28T20:00:00Z").getTime());
  const sets = [
    {
      exerciseId: "back_squat",
      sets: [{ weight: 100, reps: 3, result: "success" as const }],
    },
  ];
  prepareWorkoutProgress(
    done,
    {
      kind: "log_workout_progress",
      workout: { title: "Snatch", date, category: "open", exercises: sets },
      completion: "completed",
      sessionId: id,
    },
    date,
  );
  assert.equal(done.sessions[0].durationMinutes, 90);
  // Told after the fact, with the length the athlete gave.
  prepareSession(
    done,
    {
      kind: "record_session",
      workout: {
        title: "Evening pulls",
        date,
        category: "open",
        durationMinutes: 40,
        exercises: sets,
      },
      separateSession: true,
    },
    date,
  );
  // And one told without a length: none is invented.
  prepareSession(
    done,
    {
      kind: "record_session",
      workout: {
        title: "Accessories",
        date,
        category: "open",
        exercises: sets,
      },
      separateSession: true,
    },
    date,
  );
  assert.deepEqual(
    done.sessions.map((w) => w.durationMinutes),
    [90, 40, null],
  );
  const merged = mergeWorkoutSessions(
    done,
    done.sessions.map((w) => w.id),
    "Snatch",
    "completed",
  );
  // 90 + 40 minutes; the untimed entry and the gaps between add nothing.
  assert.equal(merged.workout.durationMinutes, 130);
});

test("Coach logging a whole workout in one go gives it no length", async () => {
  const { prepareWorkoutProgress } =
    await import("../lib/agent/prepare-workouts");
  const s = journal(88);
  prepareWorkoutProgress(
    s,
    {
      kind: "log_workout_progress",
      workout: {
        title: "Snatch",
        date,
        category: "open",
        exercises: [
          {
            exerciseId: "snatch",
            sets: [{ weight: 70, reps: 2, result: "success" }],
          },
        ],
      },
      completion: "completed",
    },
    date,
  );
  assert.equal(s.sessions[0].durationMinutes, null);
  assert.equal(strengthBurn(s, s.sessions[0]), null);
  const day = dayForCoach(s, date);
  assert.equal(day.workouts[0].duration, "not recorded");
  assert.deepEqual(day.burnedInTraining, {
    includes_estimates: true,
    net_of_rest: true,
    lifting_sessions_without_length: 1,
  });
  assert.match(describeDay(day), /length not recorded/);
  assert.deepEqual(burnedLines(burnedToday(s, date)!), [
    {
      label: "Training",
      kcal: 0,
      text: "",
      note: "No estimate for 1 session without a recorded length",
    },
  ]);
});

test("Coach sees each activity's calories and the day's total", () => {
  const s = journal(80);
  activity(s, { activity: "rowing", durationSeconds: 900, caloriesKcal: 88 });
  activity(s, {
    activity: "other",
    title: "StairMaster",
    durationSeconds: 1200,
  });
  const day = dayForCoach(s, date);
  assert.deepEqual(
    day.activities.map((a) => [
      a.calories_kcal,
      a.calories_estimated,
      a.calories_estimated_from,
    ]),
    [
      [88, true, "typed in"],
      [220, true, "activity and duration"],
    ],
  );
  assert.deepEqual(day.burnedInTraining, {
    kcal: 310,
    includes_estimates: true,
    net_of_rest: true,
  });
  assert.deepEqual(dayBurn(s, date), {
    kcal: 310,
    estimated: true,
    count: 2,
    untimed: 0,
    unestimated: 0,
  });
  assert.match(describeDay(day), /about 220 kcal estimated/);
  assert.match(describeDay(day), /15 min, about 88 kcal/);
});

test("Today shows Apple Health's active energy and training apart, as estimates", () => {
  const s = journal(80);
  assert.equal(burnedToday(s, date), null);
  activity(s, {
    activity: "other",
    title: "StairMaster",
    durationSeconds: 1200,
  });
  assert.deepEqual(burnedToday(s, date), {
    active: null,
    training: { kcal: 220, count: 1, untimed: 0, unestimated: 0 },
  });
  s.health.vitals = [
    { date, activeEnergyKcal: 612, updatedAt: "2026-09-28T12:00:00.000Z" },
  ] as never;
  const both = burnedToday(s, date)!;
  assert.deepEqual(both.active, {
    kcal: 610,
    unusual: false,
    syncedAt: "2026-09-28T12:00:00.000Z",
  });
  // Lifting Apple never saw stays on its own line, never added in.
  assert.deepEqual(burnedLines(both), [
    {
      label: "Active energy",
      kcal: 610,
      text: "~610",
      note: "Apple Health, so far",
    },
    { label: "Training", kcal: 220, text: "~220", note: "Estimated" },
  ]);
  // Implausible values are held within 10,000 kcal and flagged from 6,000.
  s.health.vitals = [{ date, activeEnergyKcal: 14000 }] as never;
  assert.equal(burnedToday(s, date)!.active!.kcal, 10000);
  assert.equal(burnedToday(s, date)!.active!.unusual, true);
  // Yesterday's active energy is not today's.
  s.health.vitals = [{ date: "2026-09-27", activeEnergyKcal: 610 }] as never;
  assert.equal(burnedToday(s, date)?.active, null);
});

test("Today and Coach report the same burned figures", () => {
  const s = journal(88);
  activity(s, {
    activity: "running",
    durationSeconds: 1800,
    caloriesKcal: 333,
  });
  s.sessions.push({
    ...createWorkout(s, days[0], date),
    startedAt: "2026-09-28T16:00:00.000Z",
    finishedAt: "2026-09-28T17:30:00.000Z",
  });
  s.health.vitals = [
    { date, activeEnergyKcal: 1234, updatedAt: "2026-09-28T18:00:00.000Z" },
  ] as never;
  const [active, training] = burnedLines(burnedToday(s, date)!);
  const day = dayForCoach(s, date);
  assert.equal(day.activeEnergy?.kcal, active.kcal);
  assert.equal(day.activeEnergy?.synced_at, "2026-09-28T18:00:00.000Z");
  assert.equal(day.burnedInTraining?.kcal, training.kcal);
  // 333 recorded, plus 4 × 88 kg × 1.5 h estimated.
  assert.equal(training.kcal, 860);
  assert.equal(day.heart_and_movement[0].active_energy_kcal, 1230);
  assert.match(
    describeDay(day),
    /Burned: active energy about 1230 kcal so far from Apple Health; training about 860 kcal estimated/,
  );
});

test("an entry's figure is the same wherever it is read", () => {
  const s = journal(80);
  const e: CardioEntry = activity(s, {
    activity: "walking",
    durationSeconds: 2700,
  });
  const burn = cardioBurn(s, e)!;
  assert.equal(dayForCoach(s, date).activities[0].calories_kcal, burn.kcal);
});

test("a session left open overnight is untimed, and nothing is left out unsaid", (t) => {
  // First set at 18:00, Finish the next morning: not a 14-hour session.
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-09-28T16:00:00Z") });
  const s = journal(88);
  s.activeWorkout = lift(s, "2026-09-28T16:00:00.000Z");
  const started = hasLoggedSet(s.activeWorkout);
  logFirstSet(s.activeWorkout);
  startClock(s.activeWorkout, started);
  t.mock.timers.setTime(at("2026-09-29T06:00:00Z").getTime());
  const done = finishWorkout(s);
  assert.equal(done.sessions[0].durationMinutes, null);
  assert.deepEqual(burnedLines(burnedToday(done, date)!), [
    {
      label: "Training",
      kcal: 0,
      text: "",
      note: "No estimate for 1 session without a recorded length",
    },
  ]);
  // A stated length too long to estimate, and an activity too long to be
  // one, are named beside the figure rather than dropped from it.
  done.sessions[0].durationMinutes = 270;
  activity(done, { activity: "walking", durationSeconds: 8 * 3600 });
  activity(done, { activity: "running", durationSeconds: 1800 });
  assert.deepEqual(dayBurn(done, date), {
    kcal: 390,
    estimated: true,
    count: 1,
    untimed: 0,
    unestimated: 2,
  });
  const [training] = burnedLines(burnedToday(done, date)!);
  assert.equal(
    training.note,
    "Estimated, not counting 2 entries too short or long to estimate",
  );
  const day = dayForCoach(done, date);
  assert.equal(day.burnedInTraining?.entries_without_estimate, 2);
  assert.match(
    describeDay(day),
    /training about 390 kcal estimated, not counting 2 entries too short or long to estimate/,
  );
  // Without a weight nothing is estimated, so nothing is said to be missing.
  done.profile.bodyweight = undefined as never;
  assert.equal(dayBurn(done, date).unestimated, 0);
});
