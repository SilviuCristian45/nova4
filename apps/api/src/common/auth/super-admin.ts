export function parseSuperAdminEmails(raw: string | undefined | null): Set<string> {
  if (!raw || !raw.trim()) return new Set();
  const emails = raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length >= 3 && entry.includes("@"));
  return new Set(emails);
}

export function isSuperAdminEmail(email: string | undefined | null, rawEnv: string | undefined | null): boolean {
  if (!email) return false;
  const allowlist = parseSuperAdminEmails(rawEnv);
  if (allowlist.size === 0) return false;
  return allowlist.has(email.trim().toLowerCase());
}
