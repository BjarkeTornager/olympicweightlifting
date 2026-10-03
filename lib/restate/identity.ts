import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

// Request signing between Restate and the app's endpoint. Restate signs each
// call with an Ed25519 private key (a PEM file on the Restate service); the
// endpoint accepts only calls signed by a key in RESTATE_IDENTITY_KEYS.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

// The form Restate logs at startup and the SDK expects: publickeyv1_ and the
// raw 32-byte public key in base58. Takes either key of the pair, or a PEM.
export function restatePublicKey(key: KeyObject | string) {
  const publicKey =
    typeof key !== "string" && key.type === "public"
      ? key
      : createPublicKey(key);
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x)
    throw Error("Restate request identity keys are Ed25519.");
  return `publickeyv1_${base58(Buffer.from(jwk.x, "base64url"))}`;
}

// A new pair: the private key as PEM for Restate, the public key for the app.
export function newIdentityKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
    publicKey: restatePublicKey(publicKey),
  };
}
