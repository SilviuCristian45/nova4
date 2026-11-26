#!/usr/bin/env node
/**
 * One-shot idempotent script that encrypts any legacy unencrypted JPEG photos already stored
 * in MinIO/S3 (`progress-photos` and `checkin-photos`) using AES-256-GCM + HKDF + AAD (`RPLGENC1`).
 * Already-encrypted objects are skipped safely.
 *
 * Usage:
 *   S3_ENDPOINT=http://localhost:9000 \
 *   S3_ACCESS_KEY_ID=... \
 *   S3_SECRET_ACCESS_KEY=... \
 *   PHOTO_ENCRYPTION_KEY=<32-byte-base64-key> \
 *   node scripts/encrypt-existing-photos.ts [--dry-run]
 */

import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const MAGIC = Buffer.from("RPLGENC1", "ascii");

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function encryptObject(plain: Buffer, masterKey: Buffer, aadContext: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const objectKey = Buffer.from(
    hkdfSync("sha256", masterKey, salt, Buffer.from(`replog-photo-v1:${aadContext}`, "utf8"), 32),
  );
  const cipher = createCipheriv("aes-256-gcm", objectKey, iv);
  cipher.setAAD(Buffer.from(aadContext, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, authTag, encrypted]);
}

async function processBucket(s3: S3Client, bucket: string, masterKey: Buffer, dryRun: boolean) {
  let continuationToken: string | undefined;
  let scanned = 0;
  let encrypted = 0;
  let skipped = 0;

  for (;;) {
    let listRes;
    try {
      listRes = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }),
      );
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === "NoSuchBucket" || status === 404) {
        console.log(`  bucket ${bucket}: [does not exist, skipped]`);
        return;
      }
      throw err;
    }

    for (const item of listRes.Contents ?? []) {
      const key = item.Key;
      if (!key) continue;
      scanned++;

      const objRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!objRes.Body) continue;
      const bytes = Buffer.from(await objRes.Body.transformToByteArray());

      if (bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
        skipped++;
        continue;
      }

      if (!dryRun) {
        const cipherBytes = encryptObject(bytes, masterKey, `${bucket}/${key}`);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: cipherBytes,
            ContentType: "application/octet-stream",
          }),
        );
      }
      encrypted++;
    }

    if (!listRes.IsTruncated || !listRes.NextContinuationToken) break;
    continuationToken = listRes.NextContinuationToken;
  }

  console.log(
    `  bucket ${bucket}: scanned=${scanned}, ${dryRun ? "wouldEncrypt" : "encrypted"}=${encrypted}, alreadyEncrypted=${skipped}`,
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const keyRaw = requireEnv("PHOTO_ENCRYPTION_KEY");
  const masterKey = Buffer.from(keyRaw, "base64");
  if (masterKey.length !== 32) {
    throw new Error("PHOTO_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)");
  }

  const s3 = new S3Client({
    region: process.env.S3_REGION?.trim() || "us-east-1",
    endpoint: requireEnv("S3_ENDPOINT"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });

  const progressBucket = process.env.S3_BUCKET_PROGRESS_PHOTOS?.trim() || "progress-photos";
  const checkinBucket = process.env.S3_BUCKET_CHECKIN_PHOTOS?.trim() || "checkin-photos";

  console.log(`Encrypting existing plaintext photos${dryRun ? " [DRY RUN]" : ""}...`);
  await processBucket(s3, progressBucket, masterKey, dryRun);
  await processBucket(s3, checkinBucket, masterKey, dryRun);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Encryption script failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
