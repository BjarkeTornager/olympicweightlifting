import { createHash } from "node:crypto";
import sharp from "sharp";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { coachPictureUsage, coachPictures } from "./db/schema";
import { uid } from "./domain";
import { providerBudget } from "./provider-budget";
import type { BudgetState } from "./tracking-status";
import { errorCategory, logFailure } from "./error-log";
import { countUse } from "./feature-use";
import { recordPicture } from "./ai-usage";

// Pictures of dishes on recipe cards. The card is on screen first; an image
// model draws the picture in the background and the apps fetch it from
// /api/coach/pictures/{id} once it is ready. Only the dish name and up to
// five ingredient names leave the server, through OpenRouter with the same
// no-collection, zero-retention routing as Coach. Pictures are kept apart
// from the photo library (coach_pictures), so one can never be a meal's
// evidence, and each goes with its card. What each cost is also kept on its
// own (coach_picture_usage), so clearing the chat doesn't reset the limits.

type Db = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const PICTURE_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// How long one attempt may take.
const PICTURE_TIMEOUT_MS = 25000;
// A picture still drawing after this was cut off by a restart.
const PICTURE_STALE_MS = 60000;
// A failed attempt is tried once more only while the picture is still fresh.
const RETRY_WITHIN_MS = 10000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// A picture still drawing, or cut off by a restart (it may have been paid
// for), counts as this much against the daily ceiling.
const DRAWING_COST_USD = 0.04;
const DAY = 86400000;

/** The model (empty switches pictures off) and the limits, from the
 * environment. */
export function pictureSettings(
  env: Record<string, string | undefined> = process.env,
) {
  const limit = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value?.trim() && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    model: env.COACH_PICTURE_MODEL?.trim() ?? "",
    perDay: limit(env.COACH_PICTURES_PER_DAY, 5),
    perMonth: limit(env.COACH_PICTURES_PER_MONTH, 30),
    dailyUsd: limit(env.COACH_PICTURES_DAILY_USD, 2),
  };
}

export function picturesEnabled() {
  return Boolean(pictureSettings().model && process.env.OPENROUTER_API_KEY);
}

// Why no picture is drawn: switched off, the AI allowance running low, the
// daily spending ceiling, or the athlete's own daily or monthly limit.
export type PictureRefusal =
  "off" | "budget" | "ceiling" | "daily_limit" | "monthly_limit";

// What the coach is told about a picture it asked for. A refusal is the same
// whatever the reason: the coach just says there's no picture this time.
export const PICTURE_DRAWING =
  "drawing: it appears on the card in a few seconds; say it's on its way and don't describe it yet";
export const PICTURE_UNAVAILABLE =
  "not available: no picture this time; the recipe card is on screen without one";

/** The prompt for a dish: its name and up to five main ingredients, cleaned
 * of anything but words, and nothing about the athlete. */
export function picturePrompt(recipe: {
  title: string;
  ingredients: { item: string }[];
}) {
  const clean = (s: string) =>
    s
      .replace(/[^\p{L}\p{N} ,'&()-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
      .trim();
  const seasoning =
    /^((sea |black |kosher )?(salt|pepper)|salt (and|&) pepper|water|((olive|vegetable|rapeseed|cooking) )?oil)$/i;
  const seen = new Set<string>();
  const items = recipe.ingredients
    .map((i) => clean(i.item))
    .filter((i) => i && !seasoning.test(i))
    .filter((i) => !seen.has(i.toLowerCase()) && seen.add(i.toLowerCase()))
    .slice(0, 5)
    .join(", ");
  return `A realistic, appetising photograph of a home-cooked dish: ${clean(recipe.title)}${items ? `, made with ${items}` : ""}. One serving on a plain plate on a wooden table, soft natural daylight, three-quarter view, shallow depth of field. Show only the food, the plate and simple cutlery. No people, hands, faces or bodies. No text, letters, numbers, labels, logos, packaging or watermarks.`;
}

/** The chat completions request for one picture. No user id is sent; cost
 * per account is kept in coach_picture_usage. */
export function pictureRequest(prompt: string, model: string) {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
    image_config: { aspect_ratio: "4:3" },
    provider: { require_parameters: true, data_collection: "deny", zdr: true },
    usage: { include: true },
  };
}

export type PictureJob = {
  userId: string;
  id: string;
  model: string;
  prompt: string;
};

/** Whether a picture may be drawn at all, checked before any transaction:
 * switched on, and the AI allowance not running low (cached for minutes). */
export async function pictureGate(
  budget: () => Promise<BudgetState> = providerBudget,
): Promise<PictureRefusal | undefined> {
  if (!picturesEnabled()) return "off";
  const state = await budget();
  return state === "low" || state === "exhausted" ? "budget" : undefined;
}

/** The limit that stops another picture now, if any: the athlete's five a
 * day and thirty a month, then the daily ceiling across every account (what
 * was spent, plus about four cents for each picture not yet finished). Every
 * picture asked for counts, drawn or not, so a failing model can't be asked
 * again and again; it is counted from coach_picture_usage, which clearing
 * the chat leaves alone. */
async function pictureLimit(
  db: Db | Transaction,
  userId: string,
): Promise<PictureRefusal | undefined> {
  const settings = pictureSettings();
  const now = Date.now();
  const day = new Date(now - DAY);
  const [mine] = await db
    .select({
      day: sql<number>`(count(*) filter (where ${coachPictureUsage.createdAt} >= ${day}))::int`,
      month: sql<number>`count(*)::int`,
    })
    .from(coachPictureUsage)
    .where(
      and(
        eq(coachPictureUsage.userId, userId),
        gte(coachPictureUsage.createdAt, new Date(now - 30 * DAY)),
      ),
    );
  if (mine.day >= settings.perDay) return "daily_limit";
  if (mine.month >= settings.perMonth) return "monthly_limit";
  const [all] = await db
    .select({
      cost: sql<number | null>`sum(${coachPictureUsage.costUsd})`,
      unfinished: sql<number>`(count(*) filter (where ${coachPictureUsage.finishedAt} is null))::int`,
    })
    .from(coachPictureUsage)
    .where(gte(coachPictureUsage.createdAt, day));
  const spent = Number(all.cost ?? 0) + DRAWING_COST_USD * all.unfinished;
  if (spent + DRAWING_COST_USD > settings.dailyUsd) return "ceiling";
}

/** What the model is asked for a picture, as a hash. */
const promptHash = (prompt: string) =>
  createHash("sha256").update(prompt).digest("hex");

/** Keeps a place for a picture of this recipe on its card's turn, which must
 * already exist, or says why there is none. The same dish asked for again
 * on the turn (a retried message) gets the picture already there, drawn or
 * still drawing, with nothing more to draw. The counts aren't locked, so a
 * burst can go one over a limit. */
export async function reservePicture(
  db: Db | Transaction,
  input: {
    userId: string;
    turnId: string;
    recipe: { title: string; ingredients: { item: string }[] };
    // From pictureGate.
    refused?: PictureRefusal;
  },
): Promise<{ id: string; job?: PictureJob } | { refused: PictureRefusal }> {
  const prompt = picturePrompt(input.recipe);
  const hash = promptHash(prompt);
  const [kept] = await db
    .select({ id: coachPictures.id })
    .from(coachPictures)
    .where(
      and(
        eq(coachPictures.userId, input.userId),
        eq(coachPictures.turnId, input.turnId),
        eq(coachPictures.promptHash, hash),
        or(
          eq(coachPictures.status, "ready"),
          and(
            eq(coachPictures.status, "drawing"),
            gte(
              coachPictures.createdAt,
              new Date(Date.now() - PICTURE_STALE_MS),
            ),
          ),
        ),
      ),
    )
    .limit(1);
  if (kept) return { id: kept.id };
  // Use older than the monthly limit counts for nothing.
  await db
    .delete(coachPictureUsage)
    .where(
      and(
        eq(coachPictureUsage.userId, input.userId),
        lt(coachPictureUsage.createdAt, new Date(Date.now() - 30 * DAY)),
      ),
    );
  const refused = input.refused ?? (await pictureLimit(db, input.userId));
  if (refused) {
    void countUse(input.userId, `coach.picture.refused.${refused}`);
    return { refused };
  }
  const job = {
    userId: input.userId,
    id: uid(),
    model: pictureSettings().model,
    prompt,
  };
  await db.insert(coachPictures).values({
    userId: job.userId,
    id: job.id,
    turnId: input.turnId,
    status: "drawing",
    promptHash: hash,
    model: job.model,
  });
  await db
    .insert(coachPictureUsage)
    .values({ userId: job.userId, pictureId: job.id });
  return { id: job.id, job };
}

/** Where a reserved picture is: drawing, ready or failed. */
export async function pictureStatus(
  db: Db | Transaction,
  userId: string,
  id: string,
) {
  const [row] = await db
    .select({ status: coachPictures.status })
    .from(coachPictures)
    .where(and(eq(coachPictures.userId, userId), eq(coachPictures.id, id)));
  return row?.status;
}

export class PictureFailure extends Error {
  constructor(
    readonly reason: string,
    readonly costUsd?: number,
  ) {
    super(`The picture failed: ${reason}`);
    this.name = "PictureFailure";
  }
}

const replySchema = z.object({
  model: z.string().max(200).optional().catch(undefined),
  usage: z
    .object({ cost: z.number().finite().min(0).optional() })
    .optional()
    .catch(undefined),
  choices: z
    .array(
      z.object({
        message: z.object({
          images: z
            .array(z.object({ image_url: z.object({ url: z.string() }) }))
            .optional()
            .catch(undefined),
        }),
      }),
    )
    .min(1),
});

/** The image in the model's reply. A reply without one (text only, or
 * refused for safety) or with anything but a PNG, JPEG or WebP data URL
 * fails with a reason code. */
export function parsePictureReply(raw: unknown) {
  const reply = replySchema.safeParse(raw);
  if (!reply.success) throw new PictureFailure("invalid");
  const costUsd = reply.data.usage?.cost;
  const url = reply.data.choices[0].message.images?.[0]?.image_url.url;
  if (!url) throw new PictureFailure("refused", costUsd);
  const data =
    /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      url,
    )?.[1];
  if (!data) throw new PictureFailure("invalid", costUsd);
  if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES)
    throw new PictureFailure("too_large", costUsd);
  return {
    image: Buffer.from(data, "base64"),
    model: reply.data.model,
    costUsd,
  };
}

/** The picture as a JPEG of at most 1024 px, re-encoded so no metadata the
 * model added is kept. */
export async function normalizePicture(input: Buffer) {
  try {
    const decoder = sharp(input, {
      limitInputPixels: 20000000,
      animated: false,
    });
    const meta = await decoder.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      throw Error("unsupported");
    return await decoder
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new PictureFailure("invalid");
  }
}

// A busy or briefly unreachable model is asked once more; a timeout or a
// refusal is final.
const retryable = (error: unknown) =>
  error instanceof PictureFailure
    ? /^http_(429|5\d\d)$/.test(error.reason)
    : error instanceof TypeError;

// Whether a picture that failed was still paid for: the model answered, or
// was cut off while drawing. An HTTP error or no connection costs nothing.
const billed = (error: unknown) =>
  error instanceof PictureFailure
    ? !error.reason.startsWith("http_")
    : !(error instanceof TypeError);

async function requestPicture(
  job: PictureJob,
  fetcher: typeof fetch,
  started: number,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(PICTURE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(pictureRequest(job.prompt, job.model)),
        signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new PictureFailure(`http_${response.status}`);
      }
      const text = await response.text();
      // A base64 picture of at most 8 MB, and the rest of the reply.
      if (text.length > 12 * 1024 * 1024) throw new PictureFailure("too_large");
      try {
        return JSON.parse(text);
      } catch {
        throw new PictureFailure("invalid");
      }
    } catch (error) {
      if (
        attempt > 0 ||
        Date.now() - started >= RETRY_WITHIN_MS ||
        !retryable(error)
      )
        throw error;
    }
  }
}

/** Draws a reserved picture and keeps it, or marks it failed with a reason
 * code. Never throws: it runs after the reply has gone. */
export async function drawPicture(
  job: PictureJob,
  fetcher: typeof fetch = fetch,
): Promise<"ready" | "failed"> {
  const started = Date.now();
  const db = getDb();
  const drawing = and(
    eq(coachPictures.userId, job.userId),
    eq(coachPictures.id, job.id),
    eq(coachPictures.status, "drawing"),
  );
  // The picture, unless the chat was cleared meanwhile, and what it cost in
  // the usage, which stays either way.
  const finish = (
    picture: Partial<typeof coachPictures.$inferInsert>,
    costUsd: number | null,
  ) =>
    db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(coachPictures)
        .set({
          ...picture,
          costUsd,
          durationMs: now.getTime() - started,
          updatedAt: now,
        })
        .where(drawing);
      await tx
        .update(coachPictureUsage)
        .set({ costUsd, finishedAt: now })
        .where(
          and(
            eq(coachPictureUsage.userId, job.userId),
            eq(coachPictureUsage.pictureId, job.id),
            isNull(coachPictureUsage.finishedAt),
          ),
        );
    });
  try {
    const reply = parsePictureReply(
      await requestPicture(job, fetcher, started),
    );
    const data = await normalizePicture(reply.image);
    await finish(
      {
        status: "ready",
        data,
        bytes: data.length,
        model: reply.model ?? job.model,
      },
      reply.costUsd ?? null,
    );
    // The AI cost ledger too (lib/ai-usage.ts).
    await recordPicture(
      job.userId,
      job.id,
      reply.model ?? job.model,
      reply.costUsd,
      DRAWING_COST_USD,
    );
    void countUse(job.userId, "coach.picture.ready");
    return "ready";
  } catch (error) {
    const reason =
      error instanceof PictureFailure ? error.reason : errorCategory(error);
    await finish(
      { status: "failed", reason: reason.slice(0, 60) },
      error instanceof PictureFailure ? (error.costUsd ?? null) : null,
    ).catch((e: unknown) => logFailure("coach_picture_failed", e, {}, "warn"));
    if (billed(error))
      await recordPicture(
        job.userId,
        job.id,
        job.model,
        error instanceof PictureFailure ? error.costUsd : undefined,
        DRAWING_COST_USD,
      );
    // Codes only: never the dish or the account.
    logFailure("coach_picture_failed", error, { reason }, "warn");
    void countUse(job.userId, "coach.picture.failed");
    return "failed";
  }
}

/** A picture for its owner: ready with its JPEG, still drawing, or gone
 * (failed, cut off, deleted or someone else's). A picture still drawing
 * after a minute was cut off by a restart and is marked failed. */
export async function readPicture(
  userId: string,
  id: string,
): Promise<{ status: "ready"; data: Buffer } | { status: "drawing" } | null> {
  const db = getDb(),
    now = new Date();
  const mine = and(eq(coachPictures.userId, userId), eq(coachPictures.id, id));
  const [row] = await db
    .select({
      status: coachPictures.status,
      data: coachPictures.data,
      createdAt: coachPictures.createdAt,
    })
    .from(coachPictures)
    .where(mine);
  if (!row) return null;
  if (row.status === "ready" && row.data)
    return { status: "ready", data: row.data };
  if (row.status !== "drawing") return null;
  if (now.getTime() - row.createdAt.getTime() < PICTURE_STALE_MS)
    return { status: "drawing" };
  await db
    .update(coachPictures)
    .set({ status: "failed", reason: "timeout", updatedAt: now })
    .where(and(mine, eq(coachPictures.status, "drawing")));
  return null;
}
