import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage, ModelResponse } from "../lib/agent/provider";
import { localClock } from "../lib/agent/time-context";
import { offsetDate } from "../lib/health";
config({ path: ".env.local", quiet: true });

const call = (name: string, args: Record<string, unknown> = {}) => ({
  function: { name, arguments: args },
});

test(
  "today's records count as read, so a simple log takes one model call; other dates and meal changes still need a read",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn } = await import("../lib/agent/engine"),
      { readJournal } = await import("../lib/server");
    const pool = getPool(),
      user = crypto.randomUUID(),
      timezone = "Europe/Copenhagen",
      today = localClock(new Date(), timezone).date,
      yesterday = offsetDate(today, -1);
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','one-call-'||$1||'@example.test',true)",
      [user],
    );
    // Proposes one change, then answers whatever came back.
    const turn = async (
      message: string,
      change: ReturnType<typeof call>,
      read?: ReturnType<typeof call>,
    ) => {
      const steps = [...(read ? [read] : []), change];
      const sent: ModelMessage[][] = [];
      const response = await runTurn(
        user,
        {
          id: crypto.randomUUID(),
          message,
          revision: (await readJournal(user)).revision,
          timezone,
        },
        async (messages): Promise<ModelResponse> => {
          sent.push(messages);
          const step = steps[sent.length - 1];
          return step
            ? { role: "assistant", content: "", tool_calls: [step] }
            : { role: "assistant", content: "Noted." };
        },
        { directLogging: true },
      );
      const toolError = sent
        .at(-1)
        ?.findLast((m) => m.role === "tool")
        ?.content.match(/"error":"([^"]+)"/)?.[1];
      return { response, calls: sent.length, toolError };
    };
    try {
      const sleep = await turn(
        "I slept 7.5 hours last night.",
        call("log_entry", {
          kind: "record_checkin",
          checkin: { date: today, sleepHours: 7.5 },
        }),
      );
      assert.equal(sleep.calls, 1, "saved without reading health_overview");
      assert.equal(
        (await readJournal(user)).state.health.checkins.find(
          (c) => c.date === today,
        )?.sleepHours,
        7.5,
      );

      const walk = await turn(
        "I walked 4.2 km in 50 minutes today.",
        call("log_entry", {
          kind: "record_cardio",
          cardio: {
            date: today,
            activity: "walking",
            durationSeconds: 3000,
            distanceKm: 4.2,
          },
        }),
      );
      assert.equal(walk.calls, 1, "saved without reading cardio_journal");
      const [activity] = (await readJournal(user)).state.cardio.sessions;
      assert.equal(activity?.distanceKm, 4.2);

      // The activity is in today's message, so a correction needs no read.
      const fix = await turn(
        "Correction: that walk was 4.5 km.",
        call("log_entry", {
          kind: "update_cardio",
          cardioId: activity.id,
          changes: { distanceKm: 4.5 },
        }),
      );
      assert.equal(fix.calls, 1);
      const corrected = (await readJournal(user)).state.cardio.sessions[0];
      assert.equal(corrected.distanceKm, 4.5);
      assert.equal(corrected.durationSeconds, 3000, "unchanged fields kept");

      const coffeeMeal = {
        date: today,
        name: "Morning coffee",
        type: "breakfast",
        source: "text",
        estimated: false,
        photoIds: [],
        items: [
          {
            name: "Coffee",
            portion: "200 ml",
            calories: 2,
            protein: 0,
            carbs: 0,
            fat: 0,
            classification: {
              foodGroups: ["drinks"],
              ingredients: [{ name: "coffee", evidence: "reported" }],
            },
          },
        ],
      };
      const coffee = await turn(
        "Had a black coffee for breakfast.",
        call("log_entry", {
          kind: "record_meal",
          meal: coffeeMeal,
        }),
      );
      assert.equal(coffee.calls, 1, "a new meal only needs today's list");
      const [meal] = (await readJournal(user)).state.nutrition.meals;
      assert.equal(meal?.name, "Morning coffee");

      // Changing a meal needs its full ingredients: still a read first.
      const change = await turn(
        "Make that coffee 300 ml.",
        call("log_entry", {
          kind: "update_meal",
          mealId: meal.id,
          meal: { ...coffeeMeal, name: "Bigger coffee" },
        }),
      );
      assert.equal(change.calls, 2);
      assert.match(change.toolError ?? "", /Read the full original meal/);
      assert.equal(
        (await readJournal(user)).state.nutrition.meals[0].name,
        "Morning coffee",
      );

      // Today's sessions count as read: a session needs only the workout
      // in progress (current_workout), not find_sessions.
      const sent: string[] = [];
      await runTurn(
        user,
        {
          id: crypto.randomUUID(),
          message: "Back squat 5 at 100 kg, still training.",
          revision: (await readJournal(user)).revision,
          timezone,
        },
        async (messages): Promise<ModelResponse> => {
          sent.push(messages.at(-1)!.content);
          if (sent.length === 1)
            return {
              role: "assistant",
              content: "",
              tool_calls: [call("current_workout")],
            };
          return {
            role: "assistant",
            content: "",
            tool_calls: [
              call("log_entry", {
                kind: "log_workout_progress",
                workout: {
                  title: "Training",
                  date: today,
                  category: "open",
                  exercises: [
                    {
                      exerciseId: "back_squat",
                      sets: [{ weight: 100, reps: 5, result: "success" }],
                    },
                  ],
                },
                completion: "ongoing",
              }),
            ],
          };
        },
        { directLogging: true },
      );
      const draft = (await readJournal(user)).state.activeWorkout;
      assert.equal(sent.length, 2, String(sent.at(-1)));
      assert.equal(draft?.exercises[0]?.exerciseId, "back_squat");

      // Finishing may name the workout in progress, and only that one.
      const wrong = await turn(
        "I'm done.",
        call("log_entry", { kind: "finish_workout", workoutId: "not-it" }),
        call("current_workout"),
      );
      assert.match(wrong.toolError ?? "", /isn't the workout in progress/);
      assert.ok((await readJournal(user)).state.activeWorkout);
      const done = await turn(
        "I'm done.",
        call("log_entry", { kind: "finish_workout", workoutId: draft!.id }),
        call("current_workout"),
      );
      assert.equal(done.calls, 2, String(done.toolError));
      assert.equal((await readJournal(user)).state.activeWorkout, null);

      // Another date still needs its own read.
      const late = await turn(
        "Yesterday I slept 6 hours.",
        call("log_entry", {
          kind: "record_checkin",
          checkin: { date: yesterday, sleepHours: 6 },
        }),
      );
      assert.equal(late.calls, 2);
      assert.match(late.toolError ?? "", /health overview/);
      assert.equal(
        (await readJournal(user)).state.health.checkins.some(
          (c) => c.date === yesterday,
        ),
        false,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
