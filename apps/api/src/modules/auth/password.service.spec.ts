import * as bcrypt from "bcryptjs";
import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("hashes passwords with Argon2id PHC format and verifies them", async () => {
    const hash1 = await service.hash("StrongPass123!");
    const hash2 = await service.hash("StrongPass123!");

    expect(hash1).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(hash1).not.toEqual(hash2); // random salt

    await expect(service.verify("StrongPass123!", hash1)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(service.verify("WrongPass123!", hash1)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("verifies legacy Supabase bcrypt hashes and signals rehash to Argon2id", async () => {
    const legacyHash = await bcrypt.hash("LegacyPass123!", 10);
    const legacy2y = legacyHash.replace(/^\$2[ab]\$/, "$2y$");

    await expect(service.verify("LegacyPass123!", legacyHash)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(service.verify("LegacyPass123!", legacy2y)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(service.verify("WrongPassword!", legacyHash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("rejects malformed or unknown password hashes cleanly", async () => {
    for (const bad of ["", "plain-text", "$argon2id$broken", "$argon2id$v=19$m=0,t=1,p=1$aa$bb"]) {
      await expect(service.verify("anything", bad)).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    }
  });
});
