import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { Client } from "pg";
import { getPool } from "../db";
import { logFailure } from "../error-log";
import { STALE_TURN_MS } from "./engine";
import type { EmitCoachEvent } from "./stream";

// A Coach turn's AG-UI events, written to Postgres as it runs
// (agent_turn_events) and streamed back from there, so a dropped connection
// can pick the reply up where it left off: each event goes out with its SSE
// id, and GET /api/agent/run?turnId=…&after=<id> sends the rest. Off unless
// COACH_TURN_EVENTS=1; then nothing is written and nothing listens.
export const turnEventsEnabled = () => process.env.COACH_TURN_EVENTS === "1";

// Pieces of the reply are merged for about this long into one row.
const MERGE_MS = 250;
// A reader looks again this often when no notification arrives.
const POLL_MS = 2000;
// A turn saves its result a moment before its last event is written, so a
// reader in another process waits this long before it calls a turn that
// ended without one finished.
const GRACE_MS = 2000;
// No reader follows a turn longer than this.
const READ_LIMIT_MS = 5 * 60000;
// Rows are removed this long after their turn ended.
export const TURN_EVENTS_KEPT_MS = 10 * 60000;
// The LISTEN connection closes after this long with no reader.
const IDLE_MS = 60000;
const PAGE = 200;
const CHANNEL = "agent_turn_events";

const encoder = new EventEncoder({ accept: "text/event-stream" });
// An event exactly as the AG-UI encoder writes it, without its framing.
export const eventJson = (event: BaseEvent) =>
  encoder.encode(event).slice("data: ".length, -2);
// Sent before the events of a turn's next attempt, after a crash cut the
// one before short: the app clears what it showed of it.
const resetEvent = (attempt: number): BaseEvent => ({
  type: EventType.CUSTOM,
  name: "coach.reset",
  value: { attempt },
});
const endsRun = (type: string | null) =>
  type === EventType.RUN_FINISHED || type === EventType.RUN_ERROR;

type TextContent = BaseEvent & { messageId: string; delta: string };
type EventRow = {
  seq: number;
  attempt: number;
  event: string;
  type: string | null;
};
type Shared = {
  // Turns written by this process, so a reader here knows when one ends.
  writers: Map<string, TurnEventWriter>;
  // Readers waiting for a turn's next events.
  waiters: Map<string, Set<() => void>>;
  listener?: Client;
  connecting?: boolean;
  retry?: ReturnType<typeof setTimeout>;
  idle?: ReturnType<typeof setTimeout>;
};
// One per process, also when the routes are bundled apart.
const processState = globalThis as typeof globalThis & {
  coachTurnEvents?: Shared;
};
const shared = (): Shared =>
  (processState.coachTurnEvents ??= { writers: new Map(), waiters: new Map() });

function wake(turnId: string) {
  for (const waiter of shared().waiters.get(turnId) ?? []) waiter();
}

// The one LISTEN connection, outside the pool, opened by the first reader.
// While it is down, readers poll every two seconds and readers of a turn
// written here are woken directly.
function listen() {
  const state = shared();
  clearTimeout(state.idle);
  state.idle = undefined;
  if (state.listener || state.connecting || state.retry) return;
  state.connecting = true;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  const lost = (error?: unknown) => {
    if (error) logFailure("turn_events_listen_failed", error, {}, "warn");
    if (state.listener === client) state.listener = undefined;
    void client.end().catch(() => {});
    if (state.waiters.size && !state.retry) {
      state.retry = setTimeout(() => {
        state.retry = undefined;
        if (state.waiters.size) listen();
      }, 5000);
      state.retry.unref();
    }
  };
  client.on("error", lost);
  client.on("notification", ({ payload }) => {
    if (payload) wake(payload);
  });
  client
    .connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .then(
      () => {
        state.connecting = false;
        state.listener = client;
        client.on("end", () => {
          if (state.listener === client) lost();
        });
        // Anything written while this connected: every reader looks again.
        for (const turnId of state.waiters.keys()) wake(turnId);
        if (!state.waiters.size) stopWhenIdle();
      },
      (error) => {
        state.connecting = false;
        lost(error);
      },
    );
}

function stopWhenIdle() {
  const state = shared();
  clearTimeout(state.idle);
  state.idle = setTimeout(stopTurnEventListener, IDLE_MS);
  state.idle.unref();
}

// Closes the LISTEN connection; the next reader opens it again.
export async function stopTurnEventListener() {
  const state = shared();
  clearTimeout(state.idle);
  clearTimeout(state.retry);
  state.idle = state.retry = undefined;
  const client = state.listener;
  state.listener = undefined;
  await client?.end().catch(() => {});
}

// Wakes a reader when its turn has new events.
function follow(turnId: string) {
  const state = shared();
  let woken = false;
  let resume: (() => void) | undefined;
  const waiter = () => {
    woken = true;
    resume?.();
  };
  const waiters = state.waiters.get(turnId) ?? new Set();
  waiters.add(waiter);
  state.waiters.set(turnId, waiters);
  listen();
  return {
    // Until the turn's next events are written, POLL_MS passes or the
    // reader leaves.
    wait(signal: AbortSignal) {
      if (woken || signal.aborted) {
        woken = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resume = undefined;
          woken = false;
          resolve();
        };
        const timer = setTimeout(done, POLL_MS);
        resume = done;
        signal.addEventListener("abort", done, { once: true });
      });
    },
    stop() {
      waiters.delete(waiter);
      if (!waiters.size && state.waiters.get(turnId) === waiters)
        state.waiters.delete(turnId);
      if (!state.waiters.size) stopWhenIdle();
    },
  };
}

// Writes one run of a turn: its events in order, the reply's pieces merged
// about every MERGE_MS, each write one statement with its notification.
// Nothing is written until the run has taken the turn (claim), so a replay,
// a limit's reply or a refusal leaves no rows. A failed write is logged and
// stops the writing; the turn itself carries on to its saved result.
export class TurnEventWriter {
  private attempt?: number;
  private seq = 0;
  private queued: string[] = [];
  private text?: TextContent;
  private textTimer?: ReturnType<typeof setTimeout>;
  private textAt = 0;
  private writes = Promise.resolve();
  private pending = false;
  private broken = false;
  private onClaimed!: () => void;
  // Where this run's events start, once it has taken the turn: after the
  // events of the attempts before it.
  position?: { after: number; attempt: number };
  readonly claimed = new Promise<void>((resolve) => (this.onClaimed = resolve));
  // Every event is written, or writing stopped.
  ended = false;

  constructor(readonly turnId: string) {}

  claim = (attempt: number) => {
    if (this.attempt !== undefined) return;
    this.attempt = attempt;
    shared().writers.set(this.turnId, this);
    this.writes = this.writes.then(async () => {
      try {
        // A retried turn numbers on from the attempts before it.
        if (attempt > 1) this.seq = await lastSeq(this.turnId);
        this.position = { after: this.seq, attempt };
      } catch (error) {
        this.fail(error);
      }
      this.onClaimed();
    });
    this.schedule();
  };

  emit: EmitCoachEvent = (event) => {
    if (this.ended || this.broken) return;
    if (event.type !== EventType.TEXT_MESSAGE_CONTENT) {
      this.takeText();
      this.queued.push(eventJson(event));
      this.schedule();
      return;
    }
    const piece = event as TextContent;
    if (this.text?.messageId === piece.messageId)
      this.text = { ...this.text, delta: this.text.delta + piece.delta };
    else {
      this.takeText();
      this.text = { ...piece };
    }
    // The first piece goes at once; later ones wait for the rest of
    // MERGE_MS and go together.
    const wait = this.textAt + MERGE_MS - Date.now();
    if (wait <= 0) {
      this.takeText();
      this.schedule();
    } else
      this.textTimer ??= setTimeout(() => {
        this.textTimer = undefined;
        this.takeText();
        this.schedule();
      }, wait);
  };

  // Writes what is left, with the run's last event when there is one.
  // True when that event is in the table; otherwise the caller sends it.
  async finish(lastEvent?: BaseEvent) {
    this.takeText();
    if (lastEvent && this.attempt !== undefined && !this.broken)
      this.queued.push(eventJson(lastEvent));
    this.schedule();
    await this.writes;
    const stored = Boolean(lastEvent) && this.attempt !== undefined;
    this.ended = true;
    const writers = shared().writers;
    if (writers.get(this.turnId) === this) writers.delete(this.turnId);
    wake(this.turnId);
    return stored && !this.broken;
  }

  private takeText() {
    clearTimeout(this.textTimer);
    this.textTimer = undefined;
    if (!this.text) return;
    this.queued.push(eventJson(this.text));
    this.text = undefined;
    this.textAt = Date.now();
  }

  // Events emitted together, or while a write is under way, go in one.
  private schedule() {
    if (this.pending || this.attempt === undefined) return;
    this.pending = true;
    this.writes = this.writes
      .then(() => new Promise((resolve) => setImmediate(resolve)))
      .then(() => {
        this.pending = false;
        return this.write(this.queued.splice(0));
      });
  }

  private async write(events: string[]) {
    if (!events.length || this.broken || !this.position) return;
    const first = this.seq + 1;
    this.seq += events.length;
    try {
      await getPool().query(
        `WITH written AS (
           INSERT INTO agent_turn_events (turn_id, seq, attempt, event)
           SELECT $1, $3::int + (n - 1)::int, $2, e::json
           FROM unnest($4::text[]) WITH ORDINALITY AS t(e, n)
           RETURNING 1
         )
         SELECT pg_notify('${CHANNEL}', $1)`,
        [this.turnId, this.attempt, first, events],
      );
    } catch (error) {
      this.fail(error);
    }
    wake(this.turnId);
  }

  private fail(error: unknown) {
    this.broken = true;
    this.queued = [];
    logFailure("turn_events_write_failed", error);
  }
}

async function lastSeq(turnId: string) {
  const { rows } = await getPool().query<{ seq: number | null }>(
    "SELECT max(seq) AS seq FROM agent_turn_events WHERE turn_id = $1",
    [turnId],
  );
  return rows[0]?.seq ?? 0;
}

// Where a reconnecting app picks a turn up: after `after`, the last SSE id
// it read, or from the start of the turn's latest attempt when it read none.
// Null when the account has no such turn.
export async function resumePoint(
  userId: string,
  turnId: string,
  after: number,
) {
  const { rows } = await getPool().query<{
    attempt: number;
    earlier: number | null;
    seen: number | null;
  }>(
    `SELECT t.attempt,
       (SELECT max(e.seq) FROM agent_turn_events e
         WHERE e.turn_id = t.id AND e.attempt < t.attempt) AS earlier,
       (SELECT e.attempt FROM agent_turn_events e
         WHERE e.turn_id = t.id AND e.seq <= $3
         ORDER BY e.seq DESC LIMIT 1) AS seen
     FROM agent_turns t WHERE t.id = $1 AND t.user_id = $2`,
    [turnId, userId, after],
  );
  const turn = rows[0];
  if (!turn) return null;
  return after > 0
    ? { after, attempt: turn.seen ?? undefined }
    : { after: turn.earlier ?? 0, attempt: turn.attempt };
}

// A turn's events after `after` as SSE frames, each with its id, then the
// ones still to come, until its last event (RUN_FINISHED or RUN_ERROR). A
// turn that ends without one (stopped, timed out, or cut off and swept)
// ends the stream; the app then reads the saved turn, as it does today.
// `attempt` is that of the event at `after`: a later attempt's events come
// after a coach.reset.
export async function* readTurnEvents(options: {
  turnId: string;
  after: number;
  attempt?: number;
  signal: AbortSignal;
  writer?: TurnEventWriter;
}): AsyncGenerator<string> {
  const { turnId, signal } = options;
  let { after, attempt } = options;
  const writer = options.writer ?? shared().writers.get(turnId);
  const follower = follow(turnId);
  const until = Date.now() + READ_LIMIT_MS;
  let endedAt: number | undefined;
  let lastLook = false;
  let failures = 0;
  // Whether the turn ended, when it isn't written here.
  const endedElsewhere = async () => {
    const { rows } = await getPool().query<{ ended: boolean }>(
      `SELECT status <> 'running' OR coalesce(started_at, created_at) < $2 AS ended
       FROM agent_turns WHERE id = $1`,
      [turnId, new Date(Date.now() - STALE_TURN_MS)],
    );
    if (rows[0] && !rows[0].ended) {
      endedAt = undefined;
      return false;
    }
    endedAt ??= Date.now();
    return Date.now() - endedAt >= GRACE_MS;
  };
  try {
    while (!signal.aborted && Date.now() < until) {
      let rows: EventRow[] = [];
      let ended = false;
      try {
        ({ rows } = await getPool().query<EventRow>(
          `SELECT seq, attempt, event::text AS event, event->>'type' AS type
           FROM agent_turn_events WHERE turn_id = $1 AND seq > $2
           ORDER BY seq LIMIT ${PAGE}`,
          [turnId, after],
        ));
        if (!rows.length && !lastLook)
          ended = writer ? writer.ended : await endedElsewhere();
        failures = 0;
      } catch (error) {
        // A busy or restarting database: look again shortly.
        if (++failures > 3) throw error;
        await follower.wait(signal);
        continue;
      }
      for (const row of rows) {
        if (attempt !== undefined && row.attempt !== attempt)
          yield `data: ${eventJson(resetEvent(row.attempt))}\n\n`;
        attempt = row.attempt;
        after = row.seq;
        yield `id: ${row.seq}\ndata: ${row.event}\n\n`;
        if (endsRun(row.type)) return;
      }
      if (rows.length === PAGE) continue;
      // Once the turn has ended, one more look finds anything written
      // just before; then the stream ends.
      if (lastLook) return;
      if (ended) {
        lastLook = true;
        continue;
      }
      await follower.wait(signal);
    }
  } finally {
    follower.stop();
  }
}

// Removes the events of turns that ended over TURN_EVENTS_KEPT_MS ago; the
// apps read the saved turn after that. Run by the sweeper. `userId` limits
// it to one account (tests share a database).
export async function deleteEndedTurnEvents(
  options: { now?: Date; userId?: string } = {},
) {
  const now = options.now ?? new Date();
  const { rowCount } = await getPool().query(
    `DELETE FROM agent_turn_events WHERE turn_id IN (
       SELECT e.turn_id FROM agent_turn_events e
       JOIN agent_turns t ON t.id = e.turn_id
       WHERE t.status <> 'running' AND ($2::text IS NULL OR t.user_id = $2)
       GROUP BY e.turn_id
       HAVING max(e.created_at) < $1
     )`,
    [new Date(now.getTime() - TURN_EVENTS_KEPT_MS), options.userId ?? null],
  );
  return rowCount ?? 0;
}
