import { randomBytes } from "node:crypto";
import {
  PHOTO_CRYPTO_OVERHEAD,
  decryptPhotoBuffer,
  encryptPhotoBuffer,
  isEncryptedPhotoBuffer,
  isJpegBuffer,
  parsePhotoEncryptionKey,
} from "./photo-crypto";

describe("photo-crypto (AES-256-GCM + HKDF + AAD)", () => {
  const keyBase64 = randomBytes(32).toString("base64");
  const masterKey = parsePhotoEncryptionKey(keyBase64)!;
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  const aad = "progress-photos/user-1/photo-1.jpg";

  it("encrypts and decrypts a JPEG cleanly, hiding JPEG bytes at rest", () => {
    const encrypted = encryptPhotoBuffer(fakeJpeg, masterKey, aad);

    expect(isEncryptedPhotoBuffer(encrypted)).toBe(true);
    expect(isJpegBuffer(encrypted)).toBe(false);
    expect(encrypted.length).toBe(fakeJpeg.length + PHOTO_CRYPTO_OVERHEAD);

    const decrypted = decryptPhotoBuffer(encrypted, masterKey, aad);
    expect(decrypted.equals(fakeJpeg)).toBe(true);
    expect(isJpegBuffer(decrypted)).toBe(true);
  });

  it("produces unique ciphertexts for identical plaintext (random salt + IV)", () => {
    const enc1 = encryptPhotoBuffer(fakeJpeg, masterKey, aad);
    const enc2 = encryptPhotoBuffer(fakeJpeg, masterKey, aad);
    expect(enc1.equals(enc2)).toBe(false);
  });

  it("rejects tampering, wrong AAD (path swapping), and wrong master keys", () => {
    const encrypted = encryptPhotoBuffer(fakeJpeg, masterKey, aad);

    // Wrong AAD (e.g. blob copied to another user's path)
    expect(() => decryptPhotoBuffer(encrypted, masterKey, "progress-photos/user-2/photo-1.jpg")).toThrow();

    // Tampered ciphertext byte
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptPhotoBuffer(tampered, masterKey, aad)).toThrow();

    // Wrong master key
    const otherKey = randomBytes(32);
    expect(() => decryptPhotoBuffer(encrypted, otherKey, aad)).toThrow();

    // Missing master key for encrypted payload
    expect(() => decryptPhotoBuffer(encrypted, null, aad)).toThrow(/PHOTO_ENCRYPTION_KEY/);
  });

  it("passes legacy unencrypted JPEGs through transparently", () => {
    expect(isEncryptedPhotoBuffer(fakeJpeg)).toBe(false);
    const out = decryptPhotoBuffer(fakeJpeg, masterKey, aad);
    expect(out.equals(fakeJpeg)).toBe(true);
  });

  it("validates PHOTO_ENCRYPTION_KEY length", () => {
    expect(parsePhotoEncryptionKey(undefined)).toBeNull();
    expect(parsePhotoEncryptionKey("   ")).toBeNull();
    expect(() => parsePhotoEncryptionKey(Buffer.from("too-short").toString("base64"))).toThrow(
      /32-byte/,
    );
  });
});
