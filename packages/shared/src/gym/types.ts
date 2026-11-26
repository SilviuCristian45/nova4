export const GYM_STAFF_ROLES = ["owner", "manager", "reception"] as const;
export type GymStaffRole = (typeof GYM_STAFF_ROLES)[number];

export const GYM_PLAN_TYPES = ["time_based", "session_pack"] as const;
export type GymPlanType = (typeof GYM_PLAN_TYPES)[number];

export const GYM_MEMBER_STATUSES = ["active", "suspended"] as const;
export type GymMemberStatus = (typeof GYM_MEMBER_STATUSES)[number];

export const GYM_SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "frozen",
  "expired",
  "exhausted",
  "cancelled",
] as const;
export type GymSubscriptionStatus = (typeof GYM_SUBSCRIPTION_STATUSES)[number];

export const GYM_PAYMENT_METHODS = ["cash", "card_pos", "bank_transfer", "online"] as const;
export type GymPaymentMethod = (typeof GYM_PAYMENT_METHODS)[number];

export const GYM_CHECKIN_METHODS = ["qr_printed", "qr_kiosk", "qr_member", "manual_override"] as const;
export type GymCheckinMethod = (typeof GYM_CHECKIN_METHODS)[number];

export const GYM_CHECKIN_OUTCOMES = [
  "allowed",
  "denied_invalid_qr",
  "denied_not_member",
  "denied_suspended",
  "denied_duplicate",
  "denied_no_subscription",
  "denied_expired",
  "denied_no_sessions",
  "denied_frozen",
  "denied_outside_hours",
] as const;
export type GymCheckinOutcome = (typeof GYM_CHECKIN_OUTCOMES)[number];

/** 7-bit mask: bit 0 = Monday .. bit 6 = Sunday (127 = all 7 days). */
export const ALL_DAYS_MASK = 127;
export const EXPIRING_SOON_DAYS = 3;
export const EXPIRING_SOON_SESSIONS = 2;

export const GYM_WEEKDAYS: readonly {
  isoDay: number;
  bit: number;
  shortRo: string;
  shortEn: string;
}[] = [
  { isoDay: 1, bit: 1 << 0, shortRo: "L", shortEn: "Mon" },
  { isoDay: 2, bit: 1 << 1, shortRo: "Ma", shortEn: "Tue" },
  { isoDay: 3, bit: 1 << 2, shortRo: "Mi", shortEn: "Wed" },
  { isoDay: 4, bit: 1 << 3, shortRo: "J", shortEn: "Thu" },
  { isoDay: 5, bit: 1 << 4, shortRo: "V", shortEn: "Fri" },
  { isoDay: 6, bit: 1 << 5, shortRo: "S", shortEn: "Sat" },
  { isoDay: 7, bit: 1 << 6, shortRo: "D", shortEn: "Sun" },
];

export function isDayAllowed(mask: number, isoWeekday: number): boolean {
  if (isoWeekday < 1 || isoWeekday > 7) return false;
  const bit = 1 << (isoWeekday - 1);
  return (mask & bit) !== 0;
}

export function toggleDayInMask(mask: number, isoWeekday: number): number {
  if (isoWeekday < 1 || isoWeekday > 7) return mask;
  const bit = 1 << (isoWeekday - 1);
  return (mask ^ bit) & ALL_DAYS_MASK;
}

export function formatMoneyCents(amountCents: number, currency = "RON", locale = "ro-RO"): string {
  const value = (Number.isFinite(amountCents) ? amountCents : 0) / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "RON",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(value % 1 === 0 ? 0 : 2)} ${currency}`;
  }
}

/**
 * Extracts a gym QR token from either a raw token string or a full check-in URL
 * such as `https://domain.com/gym/scan?code=<token>`.
 */
export function extractQrToken(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  if (trimmed.includes("://") || trimmed.startsWith("/")) {
    try {
      const parsed = new URL(trimmed, "https://replog.local");
      const code = parsed.searchParams.get("code") ?? parsed.searchParams.get("token");
      if (code && code.trim()) {
        return code.trim();
      }
    } catch {
      // Fall through to raw string handling.
    }
  }

  const queryMatch = trimmed.match(/(?:^|[?&])(?:code|token)=([^&#\s]+)/i);
  if (queryMatch?.[1]) {
    try {
      return decodeURIComponent(queryMatch[1]).trim();
    } catch {
      return queryMatch[1].trim();
    }
  }

  return trimmed;
}

export function buildGymCheckinUrl(origin: string, qrToken: string): string {
  const cleanOrigin = origin.trim().replace(/\/+$/, "");
  const encoded = encodeURIComponent(qrToken.trim());
  return cleanOrigin ? `${cleanOrigin}/gym/scan?code=${encoded}` : `/gym/scan?code=${encoded}`;
}

export function slugifyGymName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Mitigate spreadsheet formula injection when opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatGymOutcomeMessage(
  outcome: GymCheckinOutcome,
  details: {
    endsAt?: string | null;
    frozenUntil?: string | null;
    allowedFromTime?: string | null;
    allowedToTime?: string | null;
    recentCheckinTime?: string | null;
    gpsRejected?: boolean;
  },
  t: (ro: string, en: string) => string,
  locale = "ro-RO",
): string {
  const formatDate = (iso?: string | null) => {
    if (!iso) return "";
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return iso.slice(0, 10);
    return dt.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  };

  switch (outcome) {
    case "allowed":
      return t("Acces permis! Antrenament plăcut!", "Access granted! Have a great workout!");
    case "denied_invalid_qr":
      if (details.gpsRejected) {
        return t(
          "Ești prea departe de sală pentru check-in sau locația nu a fost permisă.",
          "You are too far from the gym to check in or location access was not granted.",
        );
      }
      return t(
        "Cod QR invalid sau expirat. Scanează posterul actual de la recepție.",
        "Invalid or expired QR code. Please scan the current poster at reception.",
      );
    case "denied_not_member":
      return t(
        "Contul tău nu este înregistrat ca membru la această sală. Vorbește la recepție.",
        "Your account is not registered as a member of this gym. Please speak to reception.",
      );
    case "denied_suspended":
      return t(
        "Contul tău de membru este suspendat. Te rugăm să contactezi recepția.",
        "Your gym membership is suspended. Please contact reception.",
      );
    case "denied_duplicate":
      return details.recentCheckinTime
        ? t(
            `Ești deja înregistrat la ${details.recentCheckinTime}.`,
            `You already checked in at ${details.recentCheckinTime}.`,
          )
        : t("Ai făcut deja check-in recent.", "You have already checked in recently.");
    case "denied_no_subscription":
      return t(
        "Nu ai un abonament activ. Vorbește la recepție pentru activare.",
        "You don't have an active subscription. Please speak to reception to activate one.",
      );
    case "denied_expired": {
      const dateStr = formatDate(details.endsAt);
      return dateStr
        ? t(
            `Abonamentul a expirat pe ${dateStr} — vorbește la recepție pentru reînnoire.`,
            `Your subscription expired on ${dateStr} — speak to reception to renew.`,
          )
        : t(
            "Abonamentul a expirat — vorbește la recepție pentru reînnoire.",
            "Your subscription has expired — speak to reception to renew.",
          );
    }
    case "denied_no_sessions":
      return t(
        "Ai epuizat toate ședințele din pachet — vorbește la recepție pentru reînnoire.",
        "You have no sessions remaining — speak to reception to renew.",
      );
    case "denied_frozen": {
      const untilStr = formatDate(details.frozenUntil);
      return untilStr
        ? t(
            `Abonamentul este înghețat până pe ${untilStr}.`,
            `Your subscription is frozen until ${untilStr}.`,
          )
        : t("Abonamentul tău este momentan înghețat.", "Your subscription is currently frozen.");
    }
    case "denied_outside_hours": {
      const from = details.allowedFromTime?.slice(0, 5);
      const to = details.allowedToTime?.slice(0, 5);
      return from && to
        ? t(
            `Abonamentul permite accesul doar în intervalul ${from}–${to} (sau în zilele incluse).`,
            `Your subscription only allows access between ${from}–${to} (or on included days).`,
          )
        : t(
            "Accesul nu este permis în această zi sau la această oră cu abonamentul tău.",
            "Access is not permitted on this day or at this time with your current plan.",
          );
    }
  }
}
