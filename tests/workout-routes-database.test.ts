import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

const tz = "Europe/Copenhagen";
const now = new Date("2026-09-26T18:00:00Z");

// An out-and-back walk: east along a street, then back to the start.
const out = Array.from({ length: 40 }, (_, i) => [55.67, 12.54 + i * 0.0005]);
const path = [...out, ...[...out].reverse()];

test(
  "a route recorded with an Apple Health workout reaches Coach as place names and is removed with the activity",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal } = await import("../lib/server");
    const { applyNativeAction } = await import("../lib/native-actions");
    const { syncHealth } = await import("../lib/health-sync");
    const { buildToday, flattenVisual } = await import("../lib/native-api");
    const { dayForCoach, describeDay } = await import("../lib/journal-summary");
    const { recordedRoute, routeNotesFor } =
      await import("../lib/workout-routes");
    const { recordedRouteVisual } = await import("../lib/route-summary");
    const { visualSchema } = await import("../lib/coach-visuals");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Route test',$1||'@example.test',true)",
      [id],
    );
    try {
      const walk = {
        id: crypto.randomUUID(),
        kind: "walking",
        name: "Outdoor Walk",
        start: "2026-09-26T16:00:00+02:00",
        end: "2026-09-26T16:45:00+02:00",
        durationSeconds: 2700,
        distanceKm: 3.4,
      };
      const route = {
        workoutId: walk.id,
        path,
        startPlace: "Vesterbrogade, Copenhagen",
        endPlace: "Vesterbrogade, Copenhagen",
        farthestPlace: "Frederiksberg Have\u0007",
      };

      // A route for a workout the journal has not seen yet waits.
      const early = await syncHealth(
        id,
        { timezone: tz, routes: [route] },
        now,
      );
      assert.deepEqual(early.routes, [
        { workoutId: walk.id, result: "pending" },
      ]);

      // Sent with its workout, it is stored against the new journal entry.
      const synced = await syncHealth(
        id,
        { timezone: tz, workouts: [walk], routes: [route] },
        now,
      );
      assert.deepEqual(synced.workouts, [{ id: walk.id, result: "imported" }]);
      assert.deepEqual(synced.routes, [
        { workoutId: walk.id, result: "saved" },
      ]);
      const again = await syncHealth(
        id,
        { timezone: tz, workouts: [walk], routes: [route] },
        now,
      );
      assert.equal(again.changed, false);
      assert.deepEqual(again.routes, [
        { workoutId: walk.id, result: "unchanged" },
      ]);

      let journal = await readJournal(id);
      const entry = journal.state.cardio.sessions[0]!;
      const notes = await routeNotesFor(
        id,
        journal.state,
        "2026-09-26",
        "2026-09-26",
      );
      // Coach sees where the walk went, never the coordinates.
      const day = dayForCoach(journal.state, "2026-09-26", notes);
      assert.deepEqual(day.activities[0]!.route, {
        start: "Vesterbrogade, Copenhagen",
        end: undefined,
        farthest_point: "Frederiksberg Have",
        loop: true,
        route_km: day.activities[0]!.route!.route_km,
      });
      assert.equal(day.activities[0]!.activity_id, entry.id);
      assert.ok(day.activities[0]!.route!.route_km > 2);
      assert.doesNotMatch(JSON.stringify(day), /55\.67|12\.54/);
      assert.match(
        describeDay(day),
        /Outdoor Walk, 45 min, 3\.4 km, from Vesterbrogade, Copenhagen out to Frederiksberg Have and back/,
      );

      // The app is told there is a map, and can draw it.
      const today = buildToday(
        journal.state,
        journal.revision,
        "2026-09-26",
        new Set([entry.id]),
        notes,
      );
      assert.equal(today.activities[0]!.hasRoute, true);
      assert.equal(
        today.activities[0]!.routeText,
        "From Vesterbrogade, Copenhagen out to Frederiksberg Have and back",
      );
      const recorded = await recordedRoute(id, journal.state, entry.id);
      assert.ok(recorded);
      const visual = recordedRouteVisual(entry, recorded);
      visualSchema.parse(visual);
      assert.equal(visual.recorded, true);
      assert.equal(visual.activity, "walk");
      assert.equal(visual.distanceKm, 3.4);
      assert.deepEqual(
        visual.stops.map((s) => s.label),
        [
          "Vesterbrogade, Copenhagen",
          "Frederiksberg Have",
          "Vesterbrogade, Copenhagen",
        ],
      );
      assert.equal(visual.path.length, 80);
      const flat = flattenVisual({ id: entry.id, content: visual });
      assert.equal(flat.kind, "route_map");
      assert.equal("recorded" in flat && flat.recorded, true);

      // Coach reads the walk by place name and shows the recorded map; the
      // coordinates never reach the model.
      const { runTurn } = await import("../lib/agent/engine");
      const tool = (
        name: string,
        args: Record<string, unknown>,
      ): ModelMessage => ({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name, arguments: args } }],
      });
      let step = 0;
      const turn = await runTurn(
        id,
        {
          id: crypto.randomUUID(),
          message: "Where did I walk on Saturday? Show me the map.",
          timezone: tz,
          revision: journal.revision,
        },
        async (messages) => {
          step++;
          assert.doesNotMatch(JSON.stringify(messages), /55\.67|12\.54/);
          if (step === 1)
            return tool("cardio_journal", {
              from: "2026-09-26",
              to: "2026-09-26",
            });
          if (step === 2) {
            const read = JSON.parse(messages.at(-1)!.content);
            assert.equal(
              read.entries[0].route.farthest_point,
              "Frederiksberg Have",
            );
            return tool("show_activity_route", { activityId: entry.id });
          }
          const shown = JSON.parse(messages.at(-1)!.content);
          assert.equal(shown.displayed, true);
          assert.equal(shown.start, "Vesterbrogade, Copenhagen");
          assert.equal(shown.loop, true);
          return {
            role: "assistant",
            content: "You walked out to Frederiksberg Have and back.",
          };
        },
      );
      assert.equal(step, 3);
      const shownRoute = turn.visuals?.[0]?.content;
      assert.equal(shownRoute?.kind, "route_map");
      assert.equal(
        shownRoute?.kind === "route_map" && shownRoute.recorded,
        true,
      );

      // The next turn remembers that map by its places only.
      await runTurn(
        id,
        {
          id: crypto.randomUUID(),
          message: "How far was that?",
          timezone: tz,
          revision: journal.revision,
        },
        async (messages) => {
          const history = JSON.stringify(messages);
          assert.match(history, /Displayed visuals/);
          assert.match(history, /Frederiksberg Have/);
          assert.doesNotMatch(history, /55\.67|12\.54/);
          return { role: "assistant", content: "About 3.4 km." };
        },
      );

      // Deleting the activity hides its route at once and removes it on the
      // next sync.
      await applyNativeAction(
        id,
        {
          id: crypto.randomUUID(),
          timezone: tz,
          action: { kind: "delete_cardio", cardioId: entry.id },
        },
        now,
      );
      journal = await readJournal(id);
      assert.equal(await recordedRoute(id, journal.state, entry.id), null);
      await syncHealth(id, { timezone: tz }, now);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM health_workout_routes WHERE user_id = $1",
        [id],
      );
      assert.equal(rows[0].n, 0);

      // A workout deleted in Apple Health takes its route with it.
      const run = {
        ...walk,
        id: crypto.randomUUID(),
        kind: "running",
        name: "Outdoor Run",
        start: "2026-09-25T07:00:00+02:00",
        end: "2026-09-25T07:30:00+02:00",
        durationSeconds: 1800,
      };
      const saved = await syncHealth(
        id,
        {
          timezone: tz,
          workouts: [run],
          routes: [{ workoutId: run.id, path: path.slice(0, 40) }],
        },
        now,
      );
      assert.deepEqual(saved.routes, [{ workoutId: run.id, result: "saved" }]);
      await syncHealth(id, { timezone: tz, deletedWorkoutIds: [run.id] }, now);
      const late = await syncHealth(
        id,
        {
          timezone: tz,
          routes: [{ workoutId: run.id, path: path.slice(0, 40) }],
        },
        now,
      );
      assert.deepEqual(late.routes, [{ workoutId: run.id, result: "skipped" }]);
      const left = await pool.query(
        "SELECT count(*)::int AS n FROM health_workout_routes WHERE user_id = $1",
        [id],
      );
      assert.equal(left.rows[0].n, 0);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
