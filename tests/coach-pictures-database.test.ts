import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });

const today = "2026-10-03";
const settings = [
  "COACH_PICTURE_MODEL",
  "OPENROUTER_API_KEY",
  "COACH_PICTURES_PER_DAY",
  "COACH_PICTURES_PER_MONTH",
  "COACH_PICTURES_DAILY_USD",
] as const;

test(
  "pictures of dishes are reserved with their card, drawn in the background, limited, kept apart and served only to their owner",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
    // Never the real image model: any request not given a fake fetch fails
    // as if offline, and the key is not a key.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: no network in tests");
    }) as typeof fetch;
    const saved = Object.fromEntries(settings.map((k) => [k, process.env[k]]));
    process.env.COACH_PICTURE_MODEL = "google/gemini-3.1-flash-lite-image";
    process.env.OPENROUTER_API_KEY = "test-only-not-a-key";
    delete process.env.COACH_PICTURES_PER_DAY;
    delete process.env.COACH_PICTURES_PER_MONTH;
    // Every account's pictures in this database count toward the ceiling,
    // so it is set high here and tested on its own below.
    process.env.COACH_PICTURES_DAILY_USD = "1000";

    const { createHmac, randomBytes } = await import("node:crypto");
    const { getDb, getPool } = await import("../lib/db");
    const { getAuth } = await import("../lib/auth");
    const { MIN_IOS_BUILD } = await import("../lib/native-client");
    const { runVoiceTool } = await import("../lib/voice-actions");
    const { runTurn } = await import("../lib/agent/engine");
    const { listUserImages } = await import("../lib/user-images");
    const pictures = await import("../lib/coach-pictures");
    const { GET: getPicture } =
      await import("../app/api/coach/pictures/[id]/route");
    const { DELETE: clearChat } = await import("../app/api/agent/route");
    const pool = getPool(),
      origin = new URL(process.env.BETTER_AUTH_URL).origin,
      accounts: string[] = [];
    const allowed = process.env.ALLOWED_EMAILS;

    const user = async () => {
      const id = crypto.randomUUID(),
        email = `pictures-${id}@example.test`;
      accounts.push(id);
      process.env.ALLOWED_EMAILS = [process.env.ALLOWED_EMAILS, email]
        .filter(Boolean)
        .join(",");
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Sam Jensen',$2,true)",
        [id, email],
      );
      const raw = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO auth_sessions(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [crypto.randomUUID(), raw, id],
      );
      const secret = (await getAuth().$context).secret;
      const token = `${raw}.${createHmac("sha256", secret).update(raw).digest("base64")}`;
      // As the iPhone sends them.
      const headers = {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        "X-Journal-Account": id,
        "X-Client": `ios/1.0/${MIN_IOS_BUILD}`,
      };
      return { id, headers };
    };
    const fetchPicture = (headers: Record<string, string>, id: string) =>
      getPicture(
        new Request(`${origin}/api/coach/pictures/${id}`, { headers }),
        { params: Promise.resolve({ id }) },
      );
    const rows = async (userId: string) =>
      (
        await pool.query(
          "SELECT id, turn_id, status, reason, model, cost_usd, duration_ms, bytes, data FROM coach_pictures WHERE user_id=$1 ORDER BY created_at",
          [userId],
        )
      ).rows;

    // A dish the athlete asked for, as the voice coach sends it.
    const recipe = {
      summary: "Something high in protein after training, I weigh 88 kg",
      kind: "recipe",
      title: "Salmon rice bowl",
      servings: 2,
      minutes: 25,
      ingredients: [
        { item: "Salmon fillet", amount: "250 g" },
        { item: "Jasmine rice", amount: "150 g" },
        { item: "Salt" },
        { item: "Edamame", amount: "100 g" },
      ],
      steps: ["Cook the rice.", "Pan-fry the salmon."],
      kcal: 620,
      protein_g: 42,
    };
    const card = (
      userId: string,
      args: Record<string, unknown>,
      id = crypto.randomUUID(),
    ) =>
      runVoiceTool(userId, {
        id,
        name: "show_card",
        args,
        today,
        seenPhotoIds: [],
      });
    const reserved = (result: Awaited<ReturnType<typeof card>>) => {
      assert.ok(result.ok && "data" in result && result.visual, "a card");
      const content = result.visual.content;
      assert.equal(content.kind, "recipe");
      return {
        data: result.data as Record<string, unknown>,
        pictureId: content.kind === "recipe" ? content.pictureId : undefined,
        job: result.job,
      };
    };

    // A 1600 × 1200 PNG, as an image model might send it.
    const png = await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 3,
        background: { r: 200, g: 120, b: 60 },
      },
    })
      .png()
      .toBuffer();
    const imageReply = (cost = 0.034) => ({
      model: "google/gemini-3.1-flash-lite-image",
      usage: { cost },
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            images: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${png.toString("base64")}`,
                },
              },
            ],
          },
        },
      ],
    });
    const reply =
      (body: unknown, status = 200) =>
      () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
    const fake = (...answers: (() => Response)[]) => {
      const calls: { url: string; init: RequestInit }[] = [];
      const fetcher = (async (
        url: string | URL | Request,
        init?: RequestInit,
      ) => {
        calls.push({ url: String(url), init: init ?? {} });
        return answers[Math.min(calls.length, answers.length) - 1]();
      }) as typeof fetch;
      return { fetcher, calls };
    };

    try {
      const a = await user(),
        b = await user();
      let drawn = "";

      await t.test(
        "a recipe card asked for with a picture keeps one place for it",
        async () => {
          const id = crypto.randomUUID();
          const first = await card(a.id, { ...recipe, picture: true }, id);
          const { data, pictureId, job } = reserved(first);
          assert.equal(data.picture, pictures.PICTURE_DRAWING);
          assert.ok(pictureId && job);
          assert.equal(job.id, pictureId);
          assert.equal(job.userId, a.id);
          assert.equal(job.model, "google/gemini-3.1-flash-lite-image");
          // Only the dish goes to the model, never what the athlete said.
          assert.equal(
            job.prompt,
            pictures.picturePrompt({
              title: recipe.title,
              ingredients: recipe.ingredients,
            }),
          );
          assert.doesNotMatch(job.prompt, /88|weigh|training|Sam/);
          const [row] = await rows(a.id);
          assert.equal(row.id, pictureId);
          assert.equal(row.turn_id, id);
          assert.equal(row.status, "drawing");
          // The card in the thread already points at its picture.
          const { rows: turns } = await pool.query(
            "SELECT response FROM agent_turns WHERE id=$1",
            [id],
          );
          assert.equal(
            turns[0].response.visuals[0].content.pictureId,
            pictureId,
          );
          // A retry shows the same card and draws nothing more.
          const { job: _job, ...shown } = first as typeof first & {
            job?: unknown;
          };
          void _job;
          assert.deepEqual(
            await card(a.id, { ...recipe, picture: true }, id),
            shown,
          );
          assert.equal((await rows(a.id)).length, 1);
          drawn = pictureId;

          // Not asked for, or not a dish: no picture.
          assert.equal(reserved(await card(a.id, recipe)).pictureId, undefined);
          const stats = await card(a.id, {
            summary: "My week",
            kind: "stats",
            title: "This week",
            stats: [{ label: "Sleep", value: "7.2", unit: "h" }],
            picture: true,
          });
          assert.ok(stats.ok && "data" in stats);
          assert.match(
            String((stats.data as Record<string, unknown>).picture),
            /^not available: pictures are only of dishes/,
          );
          assert.equal((await rows(a.id)).length, 1);
        },
      );

      await t.test(
        "the picture is drawn through zero-retention routing and served to its owner",
        async () => {
          // Still being drawn: ask again shortly.
          const waiting = await fetchPicture(a.headers, drawn);
          assert.equal(waiting.status, 202);
          assert.equal(waiting.headers.get("Retry-After"), "2");
          assert.deepEqual(await waiting.json(), { status: "drawing" });

          const job = {
            userId: a.id,
            id: drawn,
            model: "google/gemini-3.1-flash-lite-image",
            prompt: pictures.picturePrompt({
              title: recipe.title,
              ingredients: recipe.ingredients,
            }),
          };
          const { fetcher, calls } = fake(reply(imageReply()));
          assert.equal(await pictures.drawPicture(job, fetcher), "ready");
          assert.equal(calls.length, 1);
          assert.equal(
            calls[0].url,
            "https://openrouter.ai/api/v1/chat/completions",
          );
          assert.equal(
            new Headers(calls[0].init.headers).get("Authorization"),
            "Bearer test-only-not-a-key",
          );
          const body = JSON.parse(String(calls[0].init.body));
          assert.deepEqual(body.provider, {
            require_parameters: true,
            data_collection: "deny",
            zdr: true,
          });
          assert.deepEqual(body.messages, [
            { role: "user", content: job.prompt },
          ]);
          assert.doesNotMatch(String(calls[0].init.body), new RegExp(a.id));
          assert.ok(!("user" in body));

          const [row] = await rows(a.id);
          assert.equal(row.status, "ready");
          assert.equal(row.cost_usd, 0.034);
          assert.equal(row.model, "google/gemini-3.1-flash-lite-image");
          assert.ok(row.duration_ms >= 0);
          assert.equal(row.bytes, row.data.length);
          // Re-encoded: a JPEG of at most 1024 px.
          const meta = await sharp(row.data).metadata();
          assert.equal(meta.format, "jpeg");
          assert.deepEqual([meta.width, meta.height], [1024, 768]);

          const served = await fetchPicture(a.headers, drawn);
          assert.equal(served.status, 200);
          assert.equal(served.headers.get("Content-Type"), "image/jpeg");
          assert.equal(
            served.headers.get("Cache-Control"),
            "private, no-store",
          );
          assert.equal(served.headers.get("X-Content-Type-Options"), "nosniff");
          assert.deepEqual(
            Buffer.from(await served.arrayBuffer()),
            Buffer.from(row.data),
          );
          // Someone else's picture, or no picture at all, is not there.
          for (const [headers, id] of [
            [b.headers, drawn],
            [a.headers, crypto.randomUUID()],
            [a.headers, "not-an-id"],
          ] as const) {
            const missing = await fetchPicture(headers, id);
            assert.equal(missing.status, 404);
            assert.equal((await missing.json()).status, "unavailable");
          }
          // A finished picture is never drawn over.
          assert.equal(
            await pictures.drawPicture(job, fake(reply(imageReply())).fetcher),
            "ready",
          );
          assert.equal((await rows(a.id))[0].status, "ready");
        },
      );

      await t.test(
        "a picture added to a card later, and pictures that fail, leave the card as it was",
        async () => {
          const c = await user();
          const cardId = crypto.randomUUID();
          reserved(await card(c.id, recipe, cardId));
          const show = (id = cardId, userId = c.id) =>
            runVoiceTool(userId, {
              id: crypto.randomUUID(),
              name: "show_picture",
              args: { card_id: id },
              today,
              seenPhotoIds: [],
            });
          const added = await show();
          const { data, pictureId, job } = reserved(added);
          assert.deepEqual(data, {
            card_id: cardId,
            picture: pictures.PICTURE_DRAWING,
          });
          assert.ok(pictureId && job?.id === pictureId);
          // Asked again: the same picture, still drawing, drawn once.
          const again = reserved(await show());
          assert.equal(again.pictureId, pictureId);
          assert.equal(again.job, undefined);
          assert.equal(again.data.picture, pictures.PICTURE_DRAWING);
          assert.equal((await rows(c.id)).length, 1);

          // Text instead of a picture, as when the model refuses: failed,
          // with what it cost.
          const refused = fake(
            reply({
              usage: { cost: 0.002 },
              choices: [{ message: { content: "I can't draw that." } }],
            }),
          );
          assert.equal(
            await pictures.drawPicture(job, refused.fetcher),
            "failed",
          );
          let [row] = await rows(c.id);
          assert.deepEqual(
            [row.status, row.reason, row.cost_usd],
            ["failed", "refused", 0.002],
          );
          assert.equal(row.data, null);
          assert.equal((await fetchPicture(c.headers, pictureId)).status, 404);
          assert.equal(
            reserved(await show()).data.picture,
            pictures.PICTURE_UNAVAILABLE,
          );
          // The card itself is untouched.
          const { rows: turns } = await pool.query(
            "SELECT response FROM agent_turns WHERE id=$1",
            [cardId],
          );
          assert.equal(
            turns[0].response.visuals[0].content.title,
            recipe.title,
          );

          // A busy model is asked once more; a refused request is not.
          const next = async () => {
            const result = reserved(
              await show(
                reserved(await card(c.id, recipe)).data.card_id as string,
              ),
            );
            return result.job!;
          };
          const busy = fake(reply({ error: "busy" }, 503), reply(imageReply()));
          assert.equal(
            await pictures.drawPicture(await next(), busy.fetcher),
            "ready",
          );
          assert.equal(busy.calls.length, 2);
          const bad = fake(reply({ error: "bad request" }, 400));
          const failing = await next();
          assert.equal(
            await pictures.drawPicture(failing, bad.fetcher),
            "failed",
          );
          assert.equal(bad.calls.length, 1);
          [row] = (await rows(c.id)).filter((r) => r.id === failing.id);
          assert.equal(row.reason, "http_400");
          // Offline (the stubbed fetch): tried twice, then failed.
          const offline = await next();
          assert.equal(await pictures.drawPicture(offline), "failed");
          [row] = (await rows(c.id)).filter((r) => r.id === offline.id);
          assert.equal(row.reason, "network");

          // Only a recipe card of this athlete's can have one.
          const stats = await card(c.id, {
            summary: "My week",
            kind: "stats",
            title: "This week",
            stats: [{ label: "Sleep", value: "7.2", unit: "h" }],
          });
          assert.ok(stats.ok && "data" in stats);
          for (const result of [
            await show((stats.data as { card_id: string }).card_id),
            await show(cardId, b.id),
            await show(crypto.randomUUID()),
          ])
            assert.deepEqual(result, {
              ok: false,
              error:
                "Only a recipe card can have a picture: pass the card_id show_card returned for it.",
            });
        },
      );

      await t.test(
        "a drawing cut off by a restart is given up after a minute",
        async () => {
          const d = await user();
          const { pictureId } = reserved(
            await card(d.id, { ...recipe, picture: true }),
          );
          await pool.query(
            "UPDATE coach_pictures SET created_at = now() - interval '2 minutes' WHERE user_id=$1",
            [d.id],
          );
          assert.equal((await fetchPicture(d.headers, pictureId!)).status, 404);
          const [row] = await rows(d.id);
          assert.deepEqual([row.status, row.reason], ["failed", "timeout"]);
        },
      );

      await t.test(
        "each athlete gets five pictures a day and thirty a month, and all of them share a daily ceiling",
        async () => {
          const e = await user();
          for (let i = 0; i < 5; i++)
            assert.ok(
              reserved(await card(e.id, { ...recipe, picture: true })).job,
            );
          // The sixth card is still shown, without a picture.
          const sixth = reserved(
            await card(e.id, { ...recipe, picture: true }),
          );
          assert.equal(sixth.pictureId, undefined);
          assert.equal(sixth.job, undefined);
          assert.equal(sixth.data.picture, pictures.PICTURE_UNAVAILABLE);
          assert.equal((await rows(e.id)).length, 5);

          // Twenty-nine a few days ago, and one before this month.
          const f = await user();
          const turn = reserved(await card(f.id, recipe)).data.card_id;
          await pool.query(
            `INSERT INTO coach_pictures(user_id, id, turn_id, status, cost_usd, created_at)
             SELECT $1, gen_random_uuid()::text, $2, 'ready', 0.034,
               now() - interval '2 days' - (n || ' hours')::interval
             FROM generate_series(1, 29) AS n
             UNION ALL
             SELECT $1, gen_random_uuid()::text, $2, 'ready', 0.034, now() - interval '31 days'`,
            [f.id, turn],
          );
          const reserve = (
            userId: string,
            refused?: Parameters<typeof pictures.reservePicture>[1]["refused"],
          ) =>
            pictures.reservePicture(getDb(), {
              userId,
              turnId: String(turn),
              recipe: { title: "Porridge", ingredients: [] },
              refused,
            });
          // The thirtieth fits; the thirty-first doesn't.
          assert.ok("job" in (await reserve(f.id)));
          assert.deepEqual(await reserve(f.id), { refused: "monthly_limit" });

          // A low AI allowance (from pictureGate) refuses before counting.
          const g = await user();
          const gTurn = reserved(await card(g.id, recipe)).data.card_id;
          const reserveG = (refused?: "budget") =>
            pictures.reservePicture(getDb(), {
              userId: g.id,
              turnId: String(gTurn),
              recipe: { title: "Porridge", ingredients: [] },
              refused,
            });
          assert.deepEqual(await reserveG("budget"), { refused: "budget" });
          assert.equal((await rows(g.id)).length, 0);

          // The ceiling: what was spent today, plus about four cents for each
          // picture still drawing, across every account.
          const { rows: spent } = await pool.query(
            `SELECT coalesce(sum(cost_usd), 0) + 0.04 * count(*) FILTER (WHERE status = 'drawing') AS usd
             FROM coach_pictures WHERE created_at >= now() - interval '1 day'`,
          );
          process.env.COACH_PICTURES_DAILY_USD = String(
            Number(spent[0].usd) + 0.05,
          );
          try {
            assert.ok("job" in (await reserveG()));
            assert.deepEqual(await reserveG(), { refused: "ceiling" });
            process.env.COACH_PICTURES_DAILY_USD = "0";
            assert.deepEqual(await reserve(e.id), { refused: "daily_limit" });
            assert.deepEqual(await reserveG(), { refused: "ceiling" });
          } finally {
            process.env.COACH_PICTURES_DAILY_USD = "1000";
          }
          // Switched off: the coach is told, and nothing is kept.
          delete process.env.COACH_PICTURE_MODEL;
          try {
            assert.equal(await pictures.pictureGate(), "off");
            const off = reserved(
              await card(g.id, { ...recipe, picture: true }),
            );
            assert.equal(off.data.picture, pictures.PICTURE_UNAVAILABLE);
            assert.equal((await rows(g.id)).length, 1);
          } finally {
            process.env.COACH_PICTURE_MODEL =
              "google/gemini-3.1-flash-lite-image";
          }
        },
      );

      await t.test(
        "a picture is never a photo: not in the library, not a meal's evidence",
        async () => {
          assert.ok(!(await listUserImages(a.id)).some((p) => p.id === drawn));
          const photos = await runVoiceTool(a.id, {
            id: crypto.randomUUID(),
            name: "list_photos",
            args: { from: "2026-09-20", to: today },
            today,
            seenPhotoIds: [],
          });
          assert.ok(photos.ok && "data" in photos);
          assert.doesNotMatch(JSON.stringify(photos.data), new RegExp(drawn));
          await assert.rejects(
            runVoiceTool(a.id, {
              id: crypto.randomUUID(),
              name: "log_meal",
              args: {
                summary: "I ate the salmon bowl",
                date: today,
                meal_type: "dinner",
                name: "Salmon rice bowl",
                items: [
                  {
                    name: "Salmon rice bowl",
                    portion: "1 bowl",
                    calories: 620,
                    protein_g: 42,
                    carbs_g: 60,
                    fat_g: 18,
                  },
                ],
                photo_ids: [drawn],
              },
              today,
              // Even as if the coach had seen it in the call.
              seenPhotoIds: [drawn],
            }),
            /Image not found in your library/,
          );
          const { rows: meals } = await pool.query(
            "SELECT state->'nutrition'->'meals' AS meals FROM journals WHERE user_id=$1",
            [a.id],
          );
          assert.doesNotMatch(
            JSON.stringify(meals[0]?.meals ?? []),
            new RegExp(drawn),
          );
        },
      );

      await t.test(
        "typed Coach draws a picture for a recipe card when asked, and only for a recipe",
        async () => {
          const h = await user();
          const outputs: string[] = [];
          const recipeCard = {
            kind: "recipe",
            title: "Skyr bowl",
            servings: 1,
            ingredients: [
              { item: "Skyr", amount: "200 g" },
              { item: "Blueberries", amount: "a handful" },
            ],
            nutrition: { kcal: 240, protein: 22 },
            picture: true,
          };
          const statsCard = {
            kind: "stats",
            title: "This week",
            stats: [{ label: "Sleep", value: "7.2", unit: "h" }],
            picture: true,
          };
          let round = 0;
          const { fetcher, calls } = fake(reply(imageReply(0.03)));
          globalThis.fetch = fetcher;
          const response = await runTurn(
            h.id,
            {
              id: crypto.randomUUID(),
              message:
                "Can you give me a high-protein breakfast recipe and show me a picture of the dish?",
              revision: 0,
              timezone: "Europe/Copenhagen",
            },
            async (messages: ModelMessage[]) => {
              if (++round === 1)
                return {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      function: { name: "show_visual", arguments: recipeCard },
                    },
                    { function: { name: "show_visual", arguments: statsCard } },
                  ],
                };
              outputs.push(
                ...messages
                  .filter((m) => m.role === "tool")
                  .map((m) => m.content),
              );
              return { role: "assistant", content: "Here's a skyr bowl." };
            },
          );
          const [shown, stats] = response.visuals ?? [];
          assert.equal(shown.content.kind, "recipe");
          const pictureId =
            shown.content.kind === "recipe"
              ? shown.content.pictureId
              : undefined;
          assert.ok(pictureId);
          assert.ok(!("picture" in shown.content), "kept off the stored card");
          assert.ok(!("pictureId" in stats.content));
          assert.equal(
            JSON.parse(outputs[0]).picture,
            pictures.PICTURE_DRAWING,
          );
          assert.match(JSON.parse(outputs[1]).picture, /^not available/);
          // Drawn while the reply goes on.
          for (
            let i = 0;
            i < 50 && (await rows(h.id))[0]?.status === "drawing";
            i++
          )
            await new Promise((r) => setTimeout(r, 100));
          const [row] = await rows(h.id);
          assert.equal(row.id, pictureId);
          assert.equal(row.status, "ready");
          // One picture, with only the dish in it. (Where Coach runs on
          // OpenRouter, its allowance may be looked up through this too.)
          const drawing = calls.filter((c) =>
            c.url.endsWith("/chat/completions"),
          );
          assert.equal(drawing.length, 1);
          assert.doesNotMatch(
            String(drawing[0].init.body),
            /high-protein breakfast|Sam/,
          );
          globalThis.fetch = (async () => {
            throw new TypeError("fetch failed: no network in tests");
          }) as typeof fetch;

          // Clearing the chat deletes its pictures with it.
          const cleared = await clearChat(
            new Request(`${origin}/api/agent`, {
              method: "DELETE",
              headers: h.headers,
            }),
          );
          assert.equal(cleared.status, 200);
          assert.equal((await rows(h.id)).length, 0);
        },
      );

      await t.test("deleting the account deletes its pictures", async () => {
        assert.ok((await rows(a.id)).length > 0);
        await pool.query("DELETE FROM users WHERE id=$1", [a.id]);
        assert.equal((await rows(a.id)).length, 0);
      });
    } finally {
      globalThis.fetch = realFetch;
      for (const key of settings)
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      if (allowed === undefined) delete process.env.ALLOWED_EMAILS;
      else process.env.ALLOWED_EMAILS = allowed;
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [accounts]);
    }
  },
);
