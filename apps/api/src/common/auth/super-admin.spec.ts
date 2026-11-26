import { isSuperAdminEmail, parseSuperAdminEmails } from "./super-admin";

describe("super-admin allowlist", () => {
  it("fails closed when SUPER_ADMIN_EMAILS is unset or blank", () => {
    expect(parseSuperAdminEmails(undefined).size).toBe(0);
    expect(parseSuperAdminEmails("   ").size).toBe(0);
    expect(isSuperAdminEmail("admin@example.com", undefined)).toBe(false);
    expect(isSuperAdminEmail("admin@example.com", "")).toBe(false);
  });

  it("matches comma/semicolon/whitespace separated emails case-insensitively", () => {
    const raw = " Admin@Example.com, owner@replog.app ; third@test.ro ";
    expect(isSuperAdminEmail("admin@example.com", raw)).toBe(true);
    expect(isSuperAdminEmail("OWNER@REPLOG.APP", raw)).toBe(true);
    expect(isSuperAdminEmail("third@test.ro", raw)).toBe(true);
    expect(isSuperAdminEmail("regular@example.com", raw)).toBe(false);
  });
});
