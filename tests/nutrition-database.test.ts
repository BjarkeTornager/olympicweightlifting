import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";
import type { ModelMessage } from "../lib/agent/provider";
config({ path: ".env.local", quiet: true });
test(
  "nutrition: private photo HTTP access, owned agent meals, retries, corrections and deletion",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    Object.assign(process.env, {
      NODE_ENV: "test",
      LOCAL_PASSWORD_AUTH: "true",
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    process.env.BETTER_AUTH_SECRET ??= "test-only-secret-".repeat(4);
    const emails = [0, 1].map(() => `food-${crypto.randomUUID()}@example.test`);
    delete process.env.OWNER_EMAIL;
    process.env.ALLOWED_EMAILS = emails.join(",");
    const { getAuth } = await import("../lib/auth"),
      { getPool } = await import("../lib/db");
    const { GET: list, POST: upload } = await import("../app/api/images/route");
    const {
      GET: read,
      DELETE: remove,
      PATCH: patch,
    } = await import("../app/api/images/[id]/route");
    const { runTurn, applyProposal, history } =
      await import("../lib/agent/engine");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { readFoodPhoto } = await import("../lib/food-photos");
    const users: { id: string; cookie: string }[] = [];
    const request = (
      index: number,
      method = "GET",
      body?: unknown,
      origin = "http://localhost:3000",
    ) =>
      new Request("http://localhost:3000/api/food/photos", {
        method,
        headers: {
          cookie: users[index]?.cookie ?? "",
          "X-Journal-Account": users[index]?.id ?? "",
          origin,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      for (const email of emails) {
        const r = await getAuth().handler(
          new Request("http://localhost:3000/api/auth/sign-up/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              origin: "http://localhost:3000",
            },
            body: JSON.stringify({
              email,
              name: "Synthetic food test",
              password: `test-only-${crypto.randomUUID()}`,
            }),
          }),
        );
        assert.equal(r.status, 200);
        users.push({
          id: (await r.json()).user.id,
          cookie: r.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
        });
      }
      const id = crypto.randomUUID(),
        context = { params: Promise.resolve({ id }) };
      const pixels = await sharp({
        create: { width: 80, height: 60, channels: 3, background: "#bd9460" },
      })
        .png()
        .toBuffer();
      const body = {
        id,
        date: "2026-09-06",
        label: "Synthetic lunch",
        image: pixels.toString("base64"),
      };
      assert.equal(
        (await upload(request(0, "POST", body, "https://attacker.test")))
          .status,
        403,
      );
      const uploaded = await upload(request(0, "POST", body));
      assert.equal(uploaded.status, 200, await uploaded.clone().text());
      const edit = { category: "food", tags: ["meal"], version: 0 };
      assert.equal(
        (await patch(request(1, "PATCH", edit), context)).status,
        404,
      );
      assert.equal(
        (
          await patch(
            request(0, "PATCH", edit, "https://attacker.test"),
            context,
          )
        ).status,
        403,
      );
      assert.equal(
        (await patch(request(2, "PATCH", edit), context)).status,
        401,
      );
      assert.equal(
        (await patch(request(0, "PATCH", edit), context)).status,
        200,
      );
      assert.equal(
        (await patch(request(0, "PATCH", edit), context)).status,
        409,
      );
      assert.equal(
        (await upload(request(0, "POST", body))).status,
        200,
        "retry does not duplicate upload",
      );
      assert.equal((await (await list(request(0))).json()).images.length, 1);
      assert.equal((await (await list(request(1))).json()).images.length, 0);
      assert.equal((await read(request(1), context)).status, 404);
      assert.equal((await read(request(2), context)).status, 401);
      const stale = request(1);
      stale.headers.set("X-Journal-Account", users[0].id);
      assert.equal((await read(stale, context)).status, 401);
      const image = await read(request(0), context);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("Content-Type"), "image/jpeg");
      assert.match(image.headers.get("Cache-Control")!, /no-store/);
      assert.ok((await image.arrayBuffer()).byteLength > 0);
      const meal = {
        date: "2026-09-06",
        name: "Synthetic lunch",
        type: "lunch",
        source: "photo",
        estimated: false,
        photoIds: [id],
        notes: "Estimated bowl size.",
        items: [
          {
            name: "Rice",
            portion: "150 g cooked",
            calories: 195,
            protein: 4,
            carbs: 42,
            fat: 0.5,
          },
        ],
      };
      const input = {
        id: crypto.randomUUID(),
        message: "Log lunch from my photo",
        timezone: "Europe/Copenhagen",
        revision: 0,
        photoIds: [id],
      };
      let invocations = 0;
      const model = async (messages: ModelMessage[]): Promise<ModelMessage> => {
        invocations++;
        assert.ok(messages.at(-1)?.images?.[0]);
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "prepare_change",
                arguments: { kind: "record_meal", meal },
              },
            },
          ],
        };
      };
      await assert.rejects(runTurn(users[1].id, input, model), /not found/);
      assert.equal(
        invocations,
        0,
        "another user's pixels never reach provider",
      );
      const response = await runTurn(users[0].id, input, model);
      assert.equal(response.proposals.length, 1);
      assert.equal(
        response.proposals[0].meal?.estimated,
        true,
        "model cannot claim an exact photo measurement",
      );
      assert.equal(
        (await readJournal(users[0].id)).state.nutrition.meals.length,
        0,
      );
      assert.deepEqual(await runTurn(users[0].id, input, model), response);
      assert.equal(invocations, 1);
      const proposal = response.proposals[0];
      await assert.rejects(applyProposal(users[1].id, proposal.id), /expired/);
      const saved = await applyProposal(users[0].id, proposal.id);
      assert.equal(saved.state.nutrition.meals.length, 1);
      assert.equal(
        (await applyProposal(users[0].id, proposal.id)).revision,
        saved.revision,
      );
      assert.equal(
        (await remove(request(0, "DELETE"), context)).status,
        409,
        "linked photos cannot disappear silently",
      );
      const foreign = await readJournal(users[1].id);
      foreign.state.nutrition.meals = saved.state.nutrition.meals;
      await assert.rejects(
        writeJournal(users[1].id, {
          ...foreign,
          mutationId: crypto.randomUUID(),
        }),
        /missing from this account/,
      );
      let round = 0;
      const correction = await runTurn(
        users[0].id,
        {
          ...input,
          id: crypto.randomUUID(),
          photoIds: [],
          revision: 1,
          message: "Correct lunch to 100 g rice",
        },
        async () =>
          ++round === 1
            ? {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "food_journal",
                      arguments: { from: "2026-09-06", to: "2026-09-06" },
                    },
                  },
                ],
              }
            : {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "prepare_change",
                      arguments: {
                        kind: "update_meal",
                        mealId: proposal.meal!.id,
                        meal: {
                          ...meal,
                          items: [
                            {
                              ...meal.items[0],
                              portion: "100 g cooked",
                              calories: 130,
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
      );
      await applyProposal(users[0].id, correction.proposals[0].id);
      const corrected = await readJournal(users[0].id);
      assert.equal(corrected.state.nutrition.meals.length, 1);
      assert.equal(corrected.state.nutrition.meals[0].items[0].calories, 130);
      assert.equal((await history(users[0].id))[0].photoIds[0], id);
      corrected.state.nutrition.meals[0].photoIds = [];
      await writeJournal(users[0].id, {
        ...corrected,
        mutationId: crypto.randomUUID(),
      });
      assert.equal((await remove(request(1, "DELETE"), context)).status, 404);
      assert.equal((await remove(request(0, "DELETE"), context)).status, 200);
      await assert.rejects(readFoodPhoto(users[0].id, id), /not found/);
      assert.equal(
        (await readJournal(users[0].id)).state.nutrition.meals.length,
        1,
        "deleting photo preserves meal nutrition",
      );
    } finally {
      await getPool().query("DELETE FROM users WHERE id=ANY($1::text[])", [
        users.map((u) => u.id),
      ]);
      await getPool().end();
    }
  },
);
