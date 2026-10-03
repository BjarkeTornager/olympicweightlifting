// Makes a new request-signing key pair for Restate (docs/restate-setup.md):
//   node --import tsx scripts/restate-identity-key.ts
// Paste each value straight into Railway's variables and don't save them
// anywhere else. The private key is base64 so it fits on one line.
import { newIdentityKey } from "../lib/restate/identity";

const { privateKeyPem, publicKey } = newIdentityKey();
console.log(
  [
    "On the restate service:",
    `RESTATE_IDENTITY_PRIVATE_KEY_B64=${Buffer.from(privateKeyPem).toString("base64")}`,
    "",
    "On lift-journal:",
    `RESTATE_IDENTITY_KEYS=${publicKey}`,
  ].join("\n"),
);
