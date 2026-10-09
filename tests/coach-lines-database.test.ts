import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
import type { ModelResponse } from "../lib/agent/provider";
import { localClock } from "../lib/agent/time-context";
import { coachLines } from "../lib/coach-lines";
import type { CoachLanguage } from "../lib/coach-language";
config({ path: ".env.local", quiet: true });

// The receipts and other lines the server writes into Coach's replies, in
// the reply's language, as the website and the iPhone app read them. Each
// account is synthetic, and no model is called.

test(
  "Coach's receipts, undo and fallback follow the reply's language, on the website and in the native history",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
      "Use a disposable database",
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db"),
      { runTurn, applyProposal, history } = await import("../lib/agent/engine"),
      { readJournal } = await import("../lib/server"),
      { buildCoach } = await import("../lib/native-api");
    const pool = getPool(),
      accounts: string[] = [],
      timezone = "Europe/Copenhagen",
      today = localClock(new Date(), timezone).date;
    const user = async () => {
      const id = crypto.randomUUID(),
        email = `lines-${id}@example.test`;
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'QA',$2,true)",
        [id, email],
      );
      await pool.query(
        "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
        [crypto.randomUUID(), email, id],
      );
      return id;
    };
    // A model that saves a check-in directly or prepares it for review, or
    // only ever reads and so never finishes.
    const model =
      (tool: string, sleepHours = 8) =>
      async (): Promise<ModelResponse> => ({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: tool,
              arguments:
                tool === "health_overview"
                  ? { date: today }
                  : {
                      kind: "record_checkin",
                      checkin: { date: today, sleepHours },
                      // A review the athlete asked for, with direct logging on.
                      ...(tool === "prepare_change"
                        ? { reviewRequested: true }
                        : {}),
                    },
            },
          },
        ],
      });
    const ask = async (
      account: string,
      message: string,
      language: CoachLanguage | undefined,
      reply: ReturnType<typeof model>,
    ) =>
      runTurn(
        account,
        {
          id: crypto.randomUUID(),
          message,
          revision: (await readJournal(account)).revision,
          timezone,
          ...(language ? { language } : {}),
        },
        reply,
        { directLogging: true },
      );
    try {
      // Messages in the chosen language.
      const said = {
        en: [
          "I slept 8 hours",
          "Prepare 7 hours of sleep for me to review",
          "How did I sleep",
        ],
        da: [
          "Jeg har sovet 8 timer",
          "Forbered 7 timers søvn, så jeg kan gennemgå det",
          "Hvordan sov jeg",
        ],
      };
      for (const language of ["en", "da"] as const) {
        const account = await user(),
          lines = coachLines(language);
        const saved = await ask(
          account,
          said[language][0],
          language,
          model("log_entry"),
        );
        assert.equal(saved.reply, lines.saved);
        const review = await ask(
          account,
          said[language][1],
          language,
          model("prepare_change", 7),
        );
        assert.equal(review.reply, lines.review);
        const unfinished = await ask(
          account,
          said[language][2],
          language,
          model("health_overview"),
        );
        assert.equal(unfinished.reply, lines.unfinished);
        // Undoing the direct save replaces its receipt, in its language.
        await applyProposal(account, saved.proposals[0].id, true);
        // The website reads the thread as the engine keeps it; the iPhone
        // app reads the same replies from the native history.
        const thread = await history(account);
        const expected = [lines.undone, lines.review, lines.unfinished];
        assert.deepEqual(
          thread.map((t) => t.reply),
          expected,
        );
        assert.deepEqual(
          buildCoach(thread).turns.map((t) => t.reply),
          expected,
        );
      }
      // A message in another language than the one chosen is answered in
      // its own; words that don't tell take the chosen one.
      const chosen = await user();
      for (const [message, language, lines] of [
        ["I slept 8 hours", "da", "en"],
        ["Jeg har sovet 8 timer", "en", "da"],
        ["8 h", "da", "da"],
      ] as const)
        assert.equal(
          (await ask(chosen, message, language, model("log_entry"))).reply,
          coachLines(lines).saved,
          message,
        );
      // The website chooses no language: Coach answers in the athlete's.
      const website = await user();
      assert.equal(
        (
          await ask(
            website,
            "Jeg har sovet 8 timer i nat, gem det",
            undefined,
            model("log_entry"),
          )
        ).reply,
        coachLines("da").saved,
      );
      // A log whose words don't tell takes the conversation's language; an
      // English log that names a Danish dish keeps English.
      for (const [message, language] of [
        ["Sov 7 timer i nat", "da"],
        ["Lunch: rugbrød med leverpostej og agurk", "en"],
        ["Breakfast: havregryn med mælk og banan", "en"],
      ] as const)
        assert.equal(
          (await ask(website, message, undefined, model("log_entry", 7))).reply,
          coachLines(language).saved,
          message,
        );
      assert.equal(
        (
          await ask(
            website,
            "Log that I slept 7 hours last night",
            undefined,
            model("log_entry", 7),
          )
        ).reply,
        coachLines("en").saved,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [accounts]);
    }
  },
);
