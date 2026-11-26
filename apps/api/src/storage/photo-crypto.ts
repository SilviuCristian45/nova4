import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const PHOTO_CRYPTO_MAGIC = Buffer.from("RPLGENC1", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
export const PHOTO_CRYPTO_OVERHEAD = PHOTO_CRYPTO_MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;

export function parsePhotoEncryptionKey(raw: string | undefined | null): Buffer | null {
  if (!raw || !raw.trim()) return null;
  const decoded = Buffer.from(raw.trim(), "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error("PHOTO_ENCRYPTION_KEY must be a base64-encoded 32-byte key (generate with node scripts/gen-secrets.mjs)");
  }
  return decoded;
}

export function isEncryptedPhotoBuffer(buffer: Buffer): boolean {
  if (buffer.length < PHOTO_CRYPTO_OVERHEAD) return false;
  return buffer.subarray(0, PHOTO_CRYPTO_MAGIC.length).equals(PHOTO_CRYPTO_MAGIC);
}

export function isJpegBuffer(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function deriveObjectKey(masterKey: Buffer, salt: Buffer, aadContext: string): Buffer {
  const derived = hkdfSync(
    "sha256",
    masterKey,
    salt,
    Buffer.from(`replog-photo-v1:${aadContext}`, "utf8"),
    KEY_BYTES,
  );
  return Buffer.from(derived);
}

/**
 * Encrypts a photo buffer with a per-object HKDF-derived AES-256-GCM key bound to `aadContext` (`${bucket}/${key}`).
 * Layout: [8B magic "RPLGENC1"][16B salt][12B iv][16B authTag][ciphertext]
 */
export function encryptPhotoBuffer(plain: Buffer, masterKey: Buffer, aadContext: string): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const objectKey = deriveObjectKey(masterKey, salt, aadContext);

  const cipher = createCipheriv("aes-256-gcm", objectKey, iv);
  cipher.setAAD(Buffer.from(aadContext, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([PHOTO_CRYPTO_MAGIC, salt, iv, authTag, encrypted]);
}

/**
 * Decrypts an `RPLGENC1` encrypted photo buffer. Legacy unencrypted JPEGs (without magic prefix)
 * are returned transparently so existing objects remain readable until migrated.
 */
export function decryptPhotoBuffer(data: Buffer, masterKey: Buffer | null, aadContext: string): Buffer {
  if (!isEncryptedPhotoBuffer(data)) {
    return data;
  }

  if (!masterKey) {
    throw new Error("PHOTO_ENCRYPTION_KEY is required to decrypt encrypted photos");
  }

  let offset = PHOTO_CRYPTO_MAGIC.length;
  const salt = data.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = data.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const authTag = data.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const ciphertext = data.subarray(offset);

  const objectKey = deriveObjectKey(masterKey, salt, aadContext);
  const decipher = createDecipheriv("aes-256-gcm", objectKey, iv);
  decipher.setAAD(Buffer.from(aadContext, "utf8"));
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
