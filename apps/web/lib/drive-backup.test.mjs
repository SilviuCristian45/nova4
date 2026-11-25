import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { decryptToken, encryptToken } from "./drive-token.ts";

test("refresh tokens round-trip through AES-GCM and reject tampering or a wrong key", () => {
  const rawKey = randomBytes(32).toString("base64");
  const stored = encryptToken("1//refresh-token", rawKey);
  assert.notEqual(stored, encryptToken("1//refresh-token", rawKey)); // random IV
  assert.equal(decryptToken(stored, rawKey), "1//refresh-token");
  const tampered = Buffer.from(stored, "base64");
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptToken(tampered.toString("base64"), rawKey));
  assert.throws(() => decryptToken(stored, randomBytes(32).toString("base64")));
  assert.throws(() => encryptToken("x", randomBytes(16).toString("base64")), /32 bytes/);
});
