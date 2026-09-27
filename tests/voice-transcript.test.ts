import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import {
  acceptTidy,
  tidyInstructions,
  tidyTranscript,
  type Line,
} from "../lib/voice-transcript";
config({ path: ".env.local", quiet: true });

const raw: Line[] = [
  { role: "you", text: "jeg spiste to æg og havregryn til morgen mad" },
  { role: "coach", text: " Got it two eggs and oatmeal for breakfast" },
];

test("a tidy line is kept only when it plausibly is the same speech", () => {
  assert.deepEqual(
    acceptTidy(raw, [
      "Jeg spiste to æg og havregryn til morgenmad.",
      "Got it, two eggs and oatmeal for breakfast.",
    ]),
    [
      { role: "you", text: "Jeg spiste to æg og havregryn til morgenmad." },
      { role: "coach", text: "Got it, two eggs and oatmeal for breakfast." },
    ],
  );
  // A speaker label the model added is dropped; one that was said stays.
  assert.deepEqual(
    acceptTidy(raw, [
      "you: Jeg spiste to æg og havregryn til morgenmad.",
      "Coach: Got it, two eggs and oatmeal for breakfast.",
    ])!.map((l) => l.text),
    [
      "Jeg spiste to æg og havregryn til morgenmad.",
      "Got it, two eggs and oatmeal for breakfast.",
    ],
  );
  assert.equal(
    acceptTidy([{ role: "you", text: "coach: log it" }], ["Coach: log it."])![0]
      .text,
    "Coach: log it.",
  );
  assert.match(tidyInstructions, /without a speaker label/);
  // A different number of lines can't be matched up: nothing is used.
  assert.equal(acceptTidy(raw, ["Only one line."]), null);
  // An empty, invented or truncated line keeps what was transcribed.
  const kept = acceptTidy(raw, [
    "",
    "Got it, two eggs and oatmeal for breakfast. Also, remember to drink water, stretch and sleep eight hours tonight.",
  ])!;
  assert.equal(kept[0].text, raw[0].text);
  assert.equal(kept[1].text, raw[1].text.trim());
  assert.match(
    tidyInstructions,
    /Never add, drop, reorder, merge or summarise/,
  );
  assert.match(tidyInstructions, /keep every line in the language/);
});

test("long calls are tidied in chunks, and a failed chunk keeps its raw lines", async () => {
  const previous = { ...process.env };
  process.env.AGENT_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.AGENT_MODEL = "openai/gpt-5.6-luna";
  try {
    const long: Line[] = Array.from({ length: 170 }, (_, i) => ({
      role: i % 2 ? "coach" : "you",
      text: `line number ${i}`,
    }));
    let calls = 0;
    const transport = (async (_url: string, init: { body: string }) => {
      calls++;
      if (calls === 2) return new Response("busy", { status: 503 });
      const sent = JSON.parse(JSON.parse(init.body).messages[1].content) as {
        lines: { text: string }[];
      };
      const content = JSON.stringify({
        lines: sent.lines.map((l) => `Line number ${l.text.split(" ")[2]}.`),
      });
      return Response.json({
        choices: [{ message: { role: "assistant", content } }],
      });
    }) as unknown as typeof fetch;
    const tidy = (await tidyTranscript(long, transport))!;
    assert.equal(calls, 3);
    assert.equal(tidy.length, 170);
    assert.equal(tidy[0].text, "Line number 0.");
    assert.equal(tidy[80].text, "line number 80", "failed chunk stays raw");
    assert.equal(tidy[169].text, "Line number 169.");
    assert.equal(tidy[169].role, "coach");
  } finally {
    process.env = previous;
  }
});

test(
  "a call's tidy transcript is shown and remembered until the call goes on",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      {
        saveVoiceTranscript,
        tidyVoiceCall,
        listVoiceCalls,
        recentConversations,
      } = await import("../lib/conversation-memory");
    const pool = getPool(),
      user = crypto.randomUUID(),
      id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA','voice-'||$1||'@example.test',true)",
      [user],
    );
    // Labelled, as the model sometimes did before labels were stripped.
    const tidyWith = async (lines: Line[]) =>
      lines.map((l) => ({ ...l, text: `${l.role}: ${l.text.trim()}.` }));
    const since = new Date(Date.now() - 86400000);
    try {
      await saveVoiceTranscript(user, { id, purpose: "checkin", entries: raw });
      let [call] = await listVoiceCalls(user, { since });
      assert.equal(call.tidied, false);
      assert.equal(call.lines[0].text, raw[0].text);

      await tidyVoiceCall(user, id, tidyWith);
      [call] = await listVoiceCalls(user, { since });
      assert.equal(call.tidied, true);
      assert.equal(call.lines[0].text, `${raw[0].text}.`);
      const [memory] = await recentConversations(user, { since });
      assert.match(
        memory.text,
        /morgen mad\./,
        "Coach remembers the tidy text",
      );

      // More of the call arrives: the live lines show until it's tidied again.
      await saveVoiceTranscript(user, {
        id,
        purpose: "checkin",
        entries: [...raw, { role: "you", text: "tak" }],
      });
      [call] = await listVoiceCalls(user, { since });
      assert.equal(call.tidied, false);
      assert.equal(call.lines.length, 3);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
    }
  },
);
