import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

test(
  "an ElevenLabs conversation belongs to the account that registered it, and no other",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { claimVoiceConversation } =
      await import("../lib/voice-conversations");
    const pool = getPool(),
      accounts: string[] = [];
    const user = async () => {
      const id = crypto.randomUUID();
      accounts.push(id);
      await pool.query(
        "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Voice test',$1||'@example.test',true)",
        [id],
      );
      return id;
    };
    try {
      const [a, b] = [await user(), await user()];
      const conversation = `conv_${crypto.randomUUID().replaceAll("-", "")}`;
      // The caller's phone registers it as the call starts.
      assert.equal(
        await claimVoiceConversation(a, conversation, crypto.randomUUID()),
        true,
      );
      // Again, as with a photo in the same call: still theirs.
      assert.equal(await claimVoiceConversation(a, conversation), true);
      // Another account can neither take it over nor use it.
      assert.equal(await claimVoiceConversation(b, conversation), false);
      const { rows } = await pool.query(
        "SELECT user_id FROM voice_conversations WHERE conversation_id=$1",
        [conversation],
      );
      assert.deepEqual(rows, [{ user_id: a }]);
      // An app that does not register: the first photo registers it.
      const unregistered = `conv_${crypto.randomUUID().replaceAll("-", "")}`;
      assert.equal(await claimVoiceConversation(b, unregistered), true);
      assert.equal(await claimVoiceConversation(a, unregistered), false);
      // Registrations from days ago are cleared.
      await pool.query(
        "UPDATE voice_conversations SET created_at=now() - interval '3 days' WHERE conversation_id=$1",
        [conversation],
      );
      await claimVoiceConversation(a, `conv_${crypto.randomUUID()}`);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM voice_conversations WHERE conversation_id=$1",
            [conversation],
          )
        ).rowCount,
        0,
      );
    } finally {
      for (const id of accounts)
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
