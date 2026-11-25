import { randomBytes } from "node:crypto";
import { decryptDriveToken, encryptDriveToken } from "./drive-token";

describe("drive-token AES-256-GCM", () => {
  it("encrypts and decrypts refresh tokens with random IVs and rejects tampering or wrong keys", () => {
    const key = randomBytes(32).toString("base64");
    const c1 = encryptDriveToken("1//refresh-token-value", key);
    const c2 = encryptDriveToken("1//refresh-token-value", key);

    expect(c1).not.toBe(c2);
    expect(decryptDriveToken(c1, key)).toBe("1//refresh-token-value");

    const tampered = Buffer.from(c1, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptDriveToken(tampered.toString("base64"), key)).toThrow();
    expect(() => decryptDriveToken(c1, randomBytes(32).toString("base64"))).toThrow();
    expect(() => encryptDriveToken("token", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
