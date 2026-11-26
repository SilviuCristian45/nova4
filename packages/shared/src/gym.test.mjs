import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_DAYS_MASK,
  buildGymCheckinUrl,
  escapeCsvCell,
  extractQrToken,
  formatMoneyCents,
  isDayAllowed,
  slugifyGymName,
  toggleDayInMask,
} from "./gym/types.ts";
import {
  calculateUnfreezeExtension,
  evaluateGymCheckin,
  haversineDistanceMeters,
  isWithinTimeWindow,
} from "./gym/checkin-rules.ts";
import { generateQrMatrix, renderQrSvg } from "./gym/qr-svg.ts";
import { formatNotification } from "./coach/interactions.ts";

const baseGym = {
  isActive: true,
  timezone: "Europe/Bucharest",
  checkinCooldownMinutes: 15,
};

function makeSub(overrides = {}) {
  return {
    id: "sub-1",
    planNameSnapshot: "Full 30 zile",
    planType: "time_based",
    status: "active",
    startsAt: new Date("2026-11-01T00:00:00Z"),
    endsAt: new Date("2026-12-01T00:00:00Z"),
    sessionsTotal: null,
    sessionsRemaining: null,
    allowedFromTime: null,
    allowedToTime: null,
    allowedDaysMask: ALL_DAYS_MASK,
    frozenAt: null,
    frozenUntil: null,
    ...overrides,
  };
}

test("extractQrToken handles raw tokens and full scan URLs", () => {
  assert.equal(extractQrToken("abc123_XYZ"), "abc123_XYZ");
  assert.equal(
    extractQrToken("https://replog.ro/gym/scan?code=tok_987654"),
    "tok_987654",
  );
  assert.equal(
    extractQrToken("/gym/scan?code=tok_local&foo=1"),
    "tok_local",
  );
  assert.equal(buildGymCheckinUrl("https://replog.ro/", "tok 1"), "https://replog.ro/gym/scan?code=tok%201");
  assert.equal(slugifyGymName("Titan Fitness Brașov!"), "titan-fitness-brasov");
});

test("weekday bitmask helpers toggle and check ISO weekdays 1..7", () => {
  assert.equal(isDayAllowed(ALL_DAYS_MASK, 1), true);
  assert.equal(isDayAllowed(ALL_DAYS_MASK, 7), true);
  const noSunday = toggleDayInMask(ALL_DAYS_MASK, 7);
  assert.equal(isDayAllowed(noSunday, 7), false);
  assert.equal(isDayAllowed(noSunday, 6), true);
  assert.equal(toggleDayInMask(noSunday, 7), ALL_DAYS_MASK);
});

test("evaluateGymCheckin enforces deterministic denial order", () => {
  const now = new Date("2026-11-26T10:00:00Z"); // 12:00 Europe/Bucharest (Thursday = ISO 4)

  // 1. Inactive/missing gym
  assert.equal(
    evaluateGymCheckin({
      now,
      gym: null,
      member: { status: "active" },
      recentAllowedCheckinAt: null,
      subscriptions: [makeSub()],
    }).outcome,
    "denied_invalid_qr",
  );

  // 2. Not a member / suspended
  assert.equal(
    evaluateGymCheckin({
      now,
      gym: baseGym,
      member: null,
      recentAllowedCheckinAt: null,
      subscriptions: [],
    }).outcome,
    "denied_not_member",
  );
  assert.equal(
    evaluateGymCheckin({
      now,
      gym: baseGym,
      member: { status: "suspended" },
      recentAllowedCheckinAt: null,
      subscriptions: [makeSub()],
    }).outcome,
    "denied_suspended",
  );

  // 3. Cooldown duplicate
  assert.equal(
    evaluateGymCheckin({
      now,
      gym: baseGym,
      member: { status: "active" },
      recentAllowedCheckinAt: new Date("2026-11-26T09:50:00Z"),
      subscriptions: [makeSub()],
    }).outcome,
    "denied_duplicate",
  );

  // Cooldown expired -> allowed
  const afterCooldown = evaluateGymCheckin({
    now,
    gym: baseGym,
    member: { status: "active" },
    recentAllowedCheckinAt: new Date("2026-11-26T09:40:00Z"),
    subscriptions: [makeSub()],
  });
  assert.equal(afterCooldown.outcome, "allowed");
  assert.equal(afterCooldown.daysLeft, 5);
  assert.equal(afterCooldown.expiringSoon, false);
});

test("evaluateGymCheckin validates frozen, expired, session_pack, and Day Time windows", () => {
  // 2026-11-26T10:00:00Z = 12:00 EET (Europe/Bucharest), Thursday (ISO 4)
  const noonBucharest = new Date("2026-11-26T10:00:00Z");
  // 2026-11-26T16:30:00Z = 18:30 EET (Europe/Bucharest), Thursday
  const eveningBucharest = new Date("2026-11-26T16:30:00Z");

  // Frozen
  assert.equal(
    evaluateGymCheckin({
      now: noonBucharest,
      gym: baseGym,
      member: { status: "active" },
      recentAllowedCheckinAt: null,
      subscriptions: [makeSub({ status: "frozen", frozenAt: new Date("2026-11-20T00:00:00Z"), frozenUntil: new Date("2026-12-05T00:00:00Z") })],
    }).outcome,
    "denied_frozen",
  );

  // Expired
  assert.equal(
    evaluateGymCheckin({
      now: noonBucharest,
      gym: baseGym,
      member: { status: "active" },
      recentAllowedCheckinAt: null,
      subscriptions: [makeSub({ endsAt: new Date("2026-11-20T00:00:00Z") })],
    }).outcome,
    "denied_expired",
  );

  // Session pack decrements and flags expiringSoon when <= 2
  const packOk = evaluateGymCheckin({
    now: noonBucharest,
    gym: baseGym,
    member: { status: "active" },
    recentAllowedCheckinAt: null,
    subscriptions: [makeSub({ planType: "session_pack", sessionsTotal: 10, sessionsRemaining: 3 })],
  });
  assert.equal(packOk.outcome, "allowed");
  assert.equal(packOk.sessionsAfter, 2);
  assert.equal(packOk.expiringSoon, true);

  // Session pack exhausted
  assert.equal(
    evaluateGymCheckin({
      now: noonBucharest,
      gym: baseGym,
      member: { status: "active" },
      recentAllowedCheckinAt: null,
      subscriptions: [makeSub({ planType: "session_pack", sessionsTotal: 10, sessionsRemaining: 0 })],
    }).outcome,
    "denied_no_sessions",
  );

  // Day Time 07:00-16:00 allowed at 12:00, denied at 18:30
  const dayTimeSub = makeSub({ allowedFromTime: "07:00:00", allowedToTime: "16:00:00" });
  assert.equal(
    evaluateGymCheckin({
      now: noonBucharest,
      gym: baseGym,
      member: { status: "active" },
      recentAllowedCheckinAt: null,
      subscriptions: [dayTimeSub],
    }).outcome,
    "allowed",
  );
  assert.equal(
    evaluateGymCheckin({
      now: eveningBucharest,
      gym: baseGym,
      member: { status: "active" },
      recentAllowedCheckinAt: null,
      subscriptions: [dayTimeSub],
    }).outcome,
    "denied_outside_hours",
  );

  // Weekday restriction: exclude Thursday (ISO 4)
  const noThursday = toggleDayInMask(ALL_DAYS_MASK, 4);
  assert.equal(isWithinTimeWindow(noonBucharest, "Europe/Bucharest", "07:00", "16:00", noThursday), false);
});

test("evaluateGymCheckin enforces optional GPS proximity radius", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const gpsGym = {
    ...baseGym,
    latitude: 44.4268,
    longitude: 26.1025,
    checkinRadiusMeters: 150,
  };

  // Missing location -> denied with gpsRejected
  const missing = evaluateGymCheckin({
    now,
    gym: gpsGym,
    member: { status: "active" },
    recentAllowedCheckinAt: null,
    subscriptions: [makeSub()],
    clientLocation: null,
  });
  assert.equal(missing.outcome, "denied_invalid_qr");
  assert.equal(missing.gpsRejected, true);

  // Far away (~2km) -> denied
  const far = evaluateGymCheckin({
    now,
    gym: gpsGym,
    member: { status: "active" },
    recentAllowedCheckinAt: null,
    subscriptions: [makeSub()],
    clientLocation: { latitude: 44.445, longitude: 26.1025 },
  });
  assert.equal(far.outcome, "denied_invalid_qr");
  assert.equal(far.gpsRejected, true);
  assert.ok((far.distanceMeters ?? 0) > 1000);

  // Inside radius (~20m) -> allowed
  const near = evaluateGymCheckin({
    now,
    gym: gpsGym,
    member: { status: "active" },
    recentAllowedCheckinAt: null,
    subscriptions: [makeSub()],
    clientLocation: { latitude: 44.4269, longitude: 26.1026 },
  });
  assert.equal(near.outcome, "allowed");
  assert.ok(haversineDistanceMeters(44.4268, 26.1025, 44.4269, 26.1026) < 150);
});

test("calculateUnfreezeExtension extends endsAt by frozen days respecting maxFreezeDays", () => {
  const frozenAt = new Date("2026-11-10T10:00:00Z");
  const unfreezeAt = new Date("2026-11-17T10:00:00Z"); // 7 days
  const endsAt = new Date("2026-12-01T10:00:00Z");

  const ext = calculateUnfreezeExtension(frozenAt, unfreezeAt, endsAt, 0, 14);
  assert.equal(ext.frozenDaysAdded, 7);
  assert.equal(ext.newTotalFrozenDays, 7);
  assert.equal(ext.newEndsAt.toISOString(), "2026-12-08T10:00:00.000Z");

  const capped = calculateUnfreezeExtension(frozenAt, unfreezeAt, endsAt, 10, 14);
  assert.equal(capped.frozenDaysAdded, 4);
  assert.equal(capped.newTotalFrozenDays, 14);
});

test("generateQrMatrix and renderQrSvg produce valid ISO QR finder patterns for URLs", () => {
  const shortMatrix = generateQrMatrix("HELLO");
  assert.equal(shortMatrix.length, 21); // Version 1

  const url = "https://replog.example.com/gym/scan?code=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const matrix = generateQrMatrix(url);
  const n = matrix.length;
  // ~86 bytes at EC Level M fits in version 5 (37x37) or 6 (41x41)
  assert.ok(n >= 37 && n <= 57 && (n - 21) % 4 === 0);
  // Check top-left finder outer border and center 3x3
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[0][6], true);
  assert.equal(matrix[1][1], false);
  assert.equal(matrix[3][3], true);
  // Dark module at (n - 8, 8)
  assert.equal(matrix[n - 8][8], true);

  // Version 7+ (130+ bytes) exercises version information bits too
  const longUrl = `${url}&extra=${"x".repeat(60)}`;
  const longMatrix = generateQrMatrix(longUrl);
  assert.ok(longMatrix.length >= 45 && (longMatrix.length - 21) % 4 === 0);

  const svg = renderQrSvg(url);
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("<path d="));
});

test("CSV escaping and money formatting and gym notifications work", () => {
  assert.equal(escapeCsvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(escapeCsvCell('Hello, "World"'), '"Hello, ""World"""');
  assert.ok(formatMoneyCents(25000, "RON", "ro-RO").includes("250"));

  const notif = formatNotification(
    {
      type: "gym_subscription_expiring",
      payload: { gym_name: "Iron Gym", plan_name: "Full", days_left: 2 },
    },
    (ro) => ro,
    "ro",
  );
  assert.equal(notif.tone, "gold");
  assert.ok(notif.body.includes("Iron Gym"));
});
