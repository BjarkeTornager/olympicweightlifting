import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

test(
  "Coach remembers recent conversations and finds older ones by topic",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool, getDb } = await import("../lib/db");
    const { agentTurns } = await import("../lib/db/schema");
    const { saveVoiceTranscript, recentConversations, searchConversations } =
      await import("../lib/conversation-memory");
    const pool = getPool(),
      accounts: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Memory test',$1||'@example.test',true)",
        [id],
      );
      return id;
    };
    try {
      const a = await user(),
        b = await user();
      const ago = (days: number) => new Date(Date.now() - days * 86400000);
      await getDb()
        .insert(agentTurns)
        .values([
          {
            id: crypto.randomUUID(),
            userId: a,
            question: "My left knee hurts when I squat deep",
            status: "done",
            response: {
              reply: "Let's keep squats above parallel this week.",
              proposals: [],
            },
            createdAt: ago(40),
          },
          {
            id: crypto.randomUUID(),
            userId: a,
            question: "What should I eat before training?",
            status: "done",
            response: {
              reply: "Rice and chicken two hours before.",
              proposals: [],
            },
            createdAt: ago(1),
          },
          {
            id: crypto.randomUUID(),
            userId: a,
            question: "[voice] Slept seven hours",
            status: "done",
            response: {
              reply: "Saved from your voice check-in.",
              proposals: [],
            },
            createdAt: ago(0),
          },
        ]);
      const call = crypto.randomUUID();
      await saveVoiceTranscript(a, {
        id: call,
        purpose: "checkin",
        entries: [
          { role: "coach", text: "How was training?" },
          { role: "you", text: "Snatch felt fast." },
        ],
      });
      // The phone re-sends the growing transcript; it replaces the old one.
      await saveVoiceTranscript(a, {
        id: call,
        purpose: "checkin",
        entries: [
          { role: "coach", text: "How was training?" },
          {
            role: "you",
            text: "Snatch felt fast. Mit knæ har det bedre i dag.",
          },
        ],
      });
      // Another account cannot overwrite that call.
      await saveVoiceTranscript(b, {
        id: call,
        purpose: "checkin",
        entries: [{ role: "you", text: "Hijacked" }],
      });

      const recent = await recentConversations(a);
      assert.deepEqual(
        recent.map((c) => c.kind),
        ["chat", "chat", "voice"],
      );
      assert.match(recent.at(-1)!.text, /knæ har det bedre/);
      // Voice saves are part of the call, not separate chats.
      assert.ok(!recent.some((c) => c.text.includes("Slept seven hours")));
      assert.equal((await recentConversations(a, { since: ago(7) })).length, 2);

      const knee = await searchConversations(a, "knee");
      assert.equal(knee.length, 1);
      assert.match(knee[0].text, /squat deep/);
      const danish = await searchConversations(a, "knæ");
      assert.equal(danish[0].kind, "voice");
      // A prefix finds other word forms.
      assert.equal((await searchConversations(a, "train")).length, 2);
      assert.deepEqual(await searchConversations(b, "knee"), []);
      assert.deepEqual(await recentConversations(b), []);
      assert.deepEqual(await searchConversations(a, "  !! "), []);

      // Coach's spoken lines keep no em dashes, saved or listed; the
      // athlete's own words are kept as said.
      const { listVoiceCalls } = await import("../lib/conversation-memory");
      const dashed = crypto.randomUUID();
      await saveVoiceTranscript(a, {
        id: dashed,
        purpose: "checkin",
        entries: [
          { role: "coach", text: "Nice work — that's a best." },
          { role: "you", text: "Thanks — it felt good." },
        ],
      });
      const listed = (await listVoiceCalls(a, { since: ago(1) })).find(
        (c) => c.id === dashed,
      )!;
      assert.deepEqual(
        listed.lines.map((l) => l.text),
        ["Nice work, that's a best.", "Thanks — it felt good."],
      );

      // A card shown in a call is remembered with what it held, so the next
      // call knows; a voice save stays part of its call.
      const c = await user();
      await getDb()
        .insert(agentTurns)
        .values([
          {
            id: crypto.randomUUID(),
            userId: c,
            question: "[voice] A high-protein dinner",
            status: "done",
            response: {
              reply: "",
              proposals: [],
              visuals: [
                {
                  id: crypto.randomUUID(),
                  content: {
                    kind: "recipe",
                    title: "Salmon rice bowl",
                    servings: 2,
                    ingredients: [
                      { item: "Salmon fillet", amount: "250 g" },
                      { item: "Sesame seeds" },
                    ],
                  },
                },
              ],
            },
            createdAt: ago(0),
          },
          {
            id: crypto.randomUUID(),
            userId: c,
            question: "[voice] Slept seven hours",
            status: "done",
            response: {
              reply: "Saved from your voice check-in.",
              proposals: [],
            },
            createdAt: ago(0),
          },
        ]);
      const cards = await recentConversations(c);
      assert.deepEqual(cards, [
        {
          at: cards[0].at,
          kind: "card",
          text: "Athlete: A high-protein dinner\nCard shown: Salmon rice bowl (recipe); ingredients: 250 g Salmon fillet, Sesame seeds",
        },
      ]);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [accounts]);
    }
  },
);
