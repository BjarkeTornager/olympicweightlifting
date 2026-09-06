import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encryptBackup,
  decryptBackup,
  checkReady,
} from "../scripts/operations.mjs";
test("encrypted backups authenticate contents and reject the wrong key or tampering", () => {
  const key = randomBytes(32),
    raw = Buffer.from("synthetic archive with exact 47.5 kg"),
    sealed = encryptBackup(raw, key);
  assert.deepEqual(decryptBackup(sealed, key), raw);
  assert.equal(sealed.includes(raw), false);
  assert.throws(() => decryptBackup(sealed, randomBytes(32)));
  sealed[sealed.length - 1] ^= 1;
  assert.throws(() => decryptBackup(sealed, key));
});
test("monitor requires database readiness rather than just an HTTP response", async () => {
  await checkReady(async () => Response.json({ status: "ready" }));
  await assert.rejects(
    checkReady(async () =>
      Response.json({ status: "unavailable" }, { status: 503 }),
    ),
  );
  await assert.rejects(checkReady(async () => Response.json({ status: "ok" })));
});
