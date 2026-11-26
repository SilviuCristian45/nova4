export function getInternalApiUrl(): string {
  const base = process.env.INTERNAL_API_URL?.trim() || "http://localhost:4000";
  return base.replace(/\/+$/, "");
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
}

export function parseSetCookieHeader(header: string): ParsedSetCookie | null {
  const parts = header.split(";").map((part) => part.trim());
  const first = parts.shift();
  if (!first) return null;
  const eqIndex = first.indexOf("=");
  if (eqIndex <= 0) return null;

  const name = first.slice(0, eqIndex).trim();
  const value = decodeURIComponent(first.slice(eqIndex + 1).trim());
  const parsed: ParsedSetCookie = { name, value };

  for (const attr of parts) {
    const [rawKey, ...rest] = attr.split("=");
    const key = rawKey.trim().toLowerCase();
    const val = rest.join("=").trim();
    if (key === "httponly") parsed.httpOnly = true;
    else if (key === "secure") parsed.secure = true;
    else if (key === "path" && val) parsed.path = val;
    else if (key === "domain" && val) parsed.domain = val;
    else if (key === "max-age" && val) {
      const n = Number(val);
      if (Number.isFinite(n)) parsed.maxAge = n;
    } else if (key === "expires" && val) {
      const date = new Date(val);
      if (!Number.isNaN(date.getTime())) parsed.expires = date;
    } else if (key === "samesite" && val) {
      const lower = val.toLowerCase();
      if (lower === "lax" || lower === "strict" || lower === "none") {
        parsed.sameSite = lower;
      }
    }
  }
  return parsed;
}

export function getSetCookiesFromResponse(response: Response): string[] {
  const headersWithGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    return headersWithGetSetCookie.getSetCookie();
  }
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}
