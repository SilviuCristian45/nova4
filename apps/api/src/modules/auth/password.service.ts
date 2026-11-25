import { Injectable } from "@nestjs/common";
import * as nodeCrypto from "node:crypto";
import { randomBytes, timingSafeEqual } from "node:crypto";
import * as bcrypt from "bcryptjs";

type Argon2Parameters = {
  message: string | Buffer;
  nonce: Buffer;
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
};

type NodeArgon2Fn = (
  algorithm: "argon2id" | "argon2i" | "argon2d",
  parameters: Argon2Parameters,
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;

function argon2Async(parameters: Argon2Parameters): Promise<Buffer> {
  const fn = (nodeCrypto as unknown as { argon2?: NodeArgon2Fn }).argon2;
  if (typeof fn !== "function") {
    return Promise.reject(new Error("Node.js 24+ crypto.argon2 is required"));
  }
  return new Promise<Buffer>((resolve, reject) => {
    fn("argon2id", parameters, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

// OWASP-aligned Argon2id defaults (64 MiB memory, 3 passes, 1 lane, 32-byte tag).
const ARGON2_PARAMS = {
  memory: 65536,
  passes: 3,
  parallelism: 1,
  tagLength: 32,
} as const;

const BCRYPT_PREFIX = /^\$2[aby]\$/;

function toUnpaddedBase64(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "");
}

function fromUnpaddedBase64(value: string): Buffer {
  const padLen = (4 - (value.length % 4)) % 4;
  return Buffer.from(value + "=".repeat(padLen), "base64");
}

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await argon2Async({
      message: password,
      nonce: salt,
      memory: ARGON2_PARAMS.memory,
      passes: ARGON2_PARAMS.passes,
      parallelism: ARGON2_PARAMS.parallelism,
      tagLength: ARGON2_PARAMS.tagLength,
    });

    return [
      "",
      "argon2id",
      "v=19",
      `m=${ARGON2_PARAMS.memory},t=${ARGON2_PARAMS.passes},p=${ARGON2_PARAMS.parallelism}`,
      toUnpaddedBase64(salt),
      toUnpaddedBase64(derived),
    ].join("$");
  }

  async verify(password: string, storedHash: string): Promise<{ valid: boolean; needsRehash: boolean }> {
    if (!storedHash || typeof storedHash !== "string") {
      return { valid: false, needsRehash: false };
    }

    if (storedHash.startsWith("$argon2id$")) {
      return this.verifyArgon2id(password, storedHash);
    }

    // Legacy Supabase auth.users.encrypted_password hashes use bcrypt ($2a$/$2b$/$2y$).
    // Verify transparently and signal the caller to re-hash to Argon2id on successful login.
    if (BCRYPT_PREFIX.test(storedHash)) {
      const normalized = storedHash.startsWith("$2y$") ? `$2b$${storedHash.slice(4)}` : storedHash;
      const valid = await bcrypt.compare(password, normalized);
      return { valid, needsRehash: valid };
    }

    return { valid: false, needsRehash: false };
  }

  private async verifyArgon2id(
    password: string,
    storedHash: string,
  ): Promise<{ valid: boolean; needsRehash: boolean }> {
    const parts = storedHash.split("$");
    // Expected: ["", "argon2id", "v=19", "m=...,t=...,p=...", "<salt>", "<hash>"]
    if (parts.length !== 6 || parts[1] !== "argon2id") {
      return { valid: false, needsRehash: false };
    }

    const paramsMap = new Map<string, number>();
    for (const pair of parts[3].split(",")) {
      const [key, raw] = pair.split("=");
      const num = Number(raw);
      if (!key || !Number.isInteger(num) || num <= 0) {
        return { valid: false, needsRehash: false };
      }
      paramsMap.set(key, num);
    }

    const memory = paramsMap.get("m");
    const passes = paramsMap.get("t");
    const parallelism = paramsMap.get("p");
    if (!memory || !passes || !parallelism) {
      return { valid: false, needsRehash: false };
    }

    const salt = fromUnpaddedBase64(parts[4]);
    const expected = fromUnpaddedBase64(parts[5]);
    if (salt.length < 8 || expected.length < 16) {
      return { valid: false, needsRehash: false };
    }

    const derived = await argon2Async({
      message: password,
      nonce: salt,
      memory,
      passes,
      parallelism,
      tagLength: expected.length,
    });

    const valid = derived.length === expected.length && timingSafeEqual(derived, expected);
    const needsRehash =
      valid &&
      (memory < ARGON2_PARAMS.memory ||
        passes < ARGON2_PARAMS.passes ||
        parallelism !== ARGON2_PARAMS.parallelism ||
        expected.length !== ARGON2_PARAMS.tagLength);

    return { valid, needsRehash };
  }
}
