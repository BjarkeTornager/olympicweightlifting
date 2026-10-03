import { failStaleTurns } from "./agent/engine";
import { deleteEndedTurnEvents } from "./agent/turn-events";
import { providerConfig } from "./agent/provider";
import { retagStalledImages } from "./user-images";
import { logFailure } from "./error-log";

// Postgres safety nets for work a restart cuts off: Coach turns left running
// and images left pending tagging. It also removes the progress events of
// Coach turns that ended ten minutes ago (lib/agent/turn-events.ts), also
// with COACH_TURN_EVENTS switched off since. Each server runs it; two at
// once are safe.
export async function sweep() {
  const staleTurns = await failStaleTurns();
  const turnEvents = await deleteEndedTurnEvents();
  // Without a provider an image can't be tagged; it stays pending until one
  // is configured, rather than using up its tries.
  const images = providerConfig()
    ? await retagStalledImages()
    : { retagged: 0, failed: 0 };
  // Counts only: no ids or content.
  if (staleTurns || turnEvents || images.retagged || images.failed)
    console.info(
      JSON.stringify({
        event: "sweeper_ran",
        staleTurns,
        turnEventsDeleted: turnEvents,
        imagesRetagged: images.retagged,
        imagesFailed: images.failed,
      }),
    );
}

const processState = globalThis as typeof globalThis & {
  sweeperTimer?: ReturnType<typeof setTimeout>;
};
export function startSweeper() {
  if (
    processState.sweeperTimer ||
    process.env.SWEEPER_WORKER !== "1" ||
    !process.env.DATABASE_URL
  )
    return;
  const tick = async () => {
    try {
      await sweep();
    } catch (error) {
      logFailure("sweeper_failed", error);
    }
    processState.sweeperTimer = setTimeout(tick, 60000);
    processState.sweeperTimer.unref();
  };
  processState.sweeperTimer = setTimeout(tick, 30000);
  processState.sweeperTimer.unref();
}
