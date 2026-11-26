import {
  ALL_DAYS_MASK,
  EXPIRING_SOON_DAYS,
  EXPIRING_SOON_SESSIONS,
  isDayAllowed,
  type GymCheckinOutcome,
  type GymMemberStatus,
  type GymPlanType,
  type GymSubscriptionStatus,
} from "./types.ts";

export interface GymSubscriptionCandidate {
  id: string;
  planNameSnapshot: string;
  planType: GymPlanType;
  status: GymSubscriptionStatus;
  startsAt: Date;
  endsAt: Date;
  sessionsTotal: number | null;
  sessionsRemaining: number | null;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  allowedDaysMask: number;
  frozenAt: Date | null;
  frozenUntil: Date | null;
}

export interface EvaluateGymCheckinInput {
  now: Date;
  gym: {
    isActive: boolean;
    timezone: string;
    checkinCooldownMinutes: number;
    latitude?: number | null;
    longitude?: number | null;
    checkinRadiusMeters?: number | null;
  } | null;
  member: {
    status: GymMemberStatus;
  } | null;
  recentAllowedCheckinAt: Date | null;
  subscriptions: GymSubscriptionCandidate[];
  clientLocation?: {
    latitude: number;
    longitude: number;
  } | null;
}

export interface EvaluateGymCheckinResult {
  outcome: GymCheckinOutcome;
  subscription: GymSubscriptionCandidate | null;
  daysLeft: number | null;
  sessionsAfter: number | null;
  expiringSoon: boolean;
  gpsRejected?: boolean;
  distanceMeters?: number | null;
  recentCheckinAt?: Date | null;
}

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function getLocalClockInTimezone(
  now: Date,
  timezone: string,
): { isoWeekday: number; minutesSinceMidnight: number; hhmm: string } {
  const safeTz = timezone?.trim() || "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  }

  const weekdayPart = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hourRaw = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minuteRaw = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const hour = Number.isFinite(hourRaw) ? hourRaw % 24 : 0;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw % 60 : 0;

  return {
    isoWeekday: WEEKDAY_MAP[weekdayPart] ?? 1,
    minutesSinceMidnight: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return hh * 60 + mm;
}

export function isWithinTimeWindow(
  now: Date,
  timezone: string,
  allowedFromTime: string | null | undefined,
  allowedToTime: string | null | undefined,
  allowedDaysMask = ALL_DAYS_MASK,
): boolean {
  const clock = getLocalClockInTimezone(now, timezone);
  if (!isDayAllowed(allowedDaysMask, clock.isoWeekday)) {
    return false;
  }

  const fromMin = parseTimeToMinutes(allowedFromTime);
  const toMin = parseTimeToMinutes(allowedToTime);
  if (fromMin === null && toMin === null) {
    return true;
  }

  const start = fromMin ?? 0;
  const end = toMin ?? 23 * 60 + 59;
  if (start <= end) {
    return clock.minutesSinceMidnight >= start && clock.minutesSinceMidnight <= end;
  }
  // Overnight window (e.g., 22:00 - 06:00)
  return clock.minutesSinceMidnight >= start || clock.minutesSinceMidnight <= end;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function evaluateGymCheckin(input: EvaluateGymCheckinInput): EvaluateGymCheckinResult {
  const { now, gym, member, recentAllowedCheckinAt, subscriptions, clientLocation } = input;

  // 1. Gym validity
  if (!gym || !gym.isActive) {
    return {
      outcome: "denied_invalid_qr",
      subscription: null,
      daysLeft: null,
      sessionsAfter: null,
      expiringSoon: false,
    };
  }

  // Optional GPS geofence check when configured on the gym
  if (
    gym.latitude !== null &&
    gym.latitude !== undefined &&
    gym.longitude !== null &&
    gym.longitude !== undefined &&
    gym.checkinRadiusMeters !== null &&
    gym.checkinRadiusMeters !== undefined &&
    gym.checkinRadiusMeters > 0
  ) {
    if (
      !clientLocation ||
      !Number.isFinite(clientLocation.latitude) ||
      !Number.isFinite(clientLocation.longitude)
    ) {
      return {
        outcome: "denied_invalid_qr",
        subscription: null,
        daysLeft: null,
        sessionsAfter: null,
        expiringSoon: false,
        gpsRejected: true,
        distanceMeters: null,
      };
    }
    const distanceMeters = haversineDistanceMeters(
      gym.latitude,
      gym.longitude,
      clientLocation.latitude,
      clientLocation.longitude,
    );
    if (distanceMeters > gym.checkinRadiusMeters) {
      return {
        outcome: "denied_invalid_qr",
        subscription: null,
        daysLeft: null,
        sessionsAfter: null,
        expiringSoon: false,
        gpsRejected: true,
        distanceMeters,
      };
    }
  }

  // 2. Member status
  if (!member) {
    return {
      outcome: "denied_not_member",
      subscription: null,
      daysLeft: null,
      sessionsAfter: null,
      expiringSoon: false,
    };
  }

  if (member.status === "suspended") {
    return {
      outcome: "denied_suspended",
      subscription: null,
      daysLeft: null,
      sessionsAfter: null,
      expiringSoon: false,
    };
  }

  // 3. Duplicate scan cooldown
  if (recentAllowedCheckinAt && gym.checkinCooldownMinutes > 0) {
    const elapsedMs = now.getTime() - recentAllowedCheckinAt.getTime();
    if (elapsedMs >= 0 && elapsedMs < gym.checkinCooldownMinutes * 60_000) {
      return {
        outcome: "denied_duplicate",
        subscription: null,
        daysLeft: null,
        sessionsAfter: null,
        expiringSoon: false,
        recentCheckinAt: recentAllowedCheckinAt,
      };
    }
  }

  // 4. Subscription evaluation
  const nonCancelled = subscriptions.filter((s) => s.status !== "cancelled");
  if (nonCancelled.length === 0) {
    return {
      outcome: "denied_no_subscription",
      subscription: null,
      daysLeft: null,
      sessionsAfter: null,
      expiringSoon: false,
    };
  }

  const nowMs = now.getTime();
  const eligible: GymSubscriptionCandidate[] = [];
  let frozenMatch: GymSubscriptionCandidate | null = null;
  let outsideHoursMatch: GymSubscriptionCandidate | null = null;
  let noSessionsMatch: GymSubscriptionCandidate | null = null;
  let latestExpired: GymSubscriptionCandidate | null = null;

  for (const sub of nonCancelled) {
    const started = sub.startsAt.getTime() <= nowMs;
    const notExpired = sub.endsAt.getTime() >= nowMs;

    if (sub.status === "frozen") {
      if (!frozenMatch || sub.endsAt.getTime() > frozenMatch.endsAt.getTime()) {
        frozenMatch = sub;
      }
      continue;
    }

    if (sub.status === "expired" || !notExpired) {
      if (!latestExpired || sub.endsAt.getTime() > latestExpired.endsAt.getTime()) {
        latestExpired = sub;
      }
      continue;
    }

    if (!started) {
      // Future pending subscription — not yet active
      continue;
    }

    if (sub.status === "exhausted" || (sub.planType === "session_pack" && (sub.sessionsRemaining ?? 0) <= 0)) {
      if (!noSessionsMatch || sub.endsAt.getTime() > noSessionsMatch.endsAt.getTime()) {
        noSessionsMatch = sub;
      }
      continue;
    }

    if (sub.status !== "active" && sub.status !== "pending") {
      continue;
    }

    const inWindow = isWithinTimeWindow(
      now,
      gym.timezone,
      sub.allowedFromTime,
      sub.allowedToTime,
      sub.allowedDaysMask,
    );
    if (!inWindow) {
      if (!outsideHoursMatch) {
        outsideHoursMatch = sub;
      }
      continue;
    }

    eligible.push(sub);
  }

  if (eligible.length > 0) {
    // Prefer time_based passes over session packs so we don't deduct a paid session unnecessarily,
    // then prefer the soonest-expiring pass.
    eligible.sort((a, b) => {
      if (a.planType !== b.planType) {
        return a.planType === "time_based" ? -1 : 1;
      }
      return a.endsAt.getTime() - b.endsAt.getTime();
    });

    const chosen = eligible[0];
    const daysLeft = Math.max(0, Math.ceil((chosen.endsAt.getTime() - nowMs) / 86_400_000));
    const sessionsAfter =
      chosen.planType === "session_pack"
        ? Math.max(0, (chosen.sessionsRemaining ?? 1) - 1)
        : null;
    const expiringSoon =
      daysLeft <= EXPIRING_SOON_DAYS ||
      (sessionsAfter !== null && sessionsAfter <= EXPIRING_SOON_SESSIONS);

    return {
      outcome: "allowed",
      subscription: chosen,
      daysLeft,
      sessionsAfter,
      expiringSoon,
    };
  }

  if (frozenMatch) {
    return {
      outcome: "denied_frozen",
      subscription: frozenMatch,
      daysLeft: null,
      sessionsAfter: frozenMatch.sessionsRemaining,
      expiringSoon: false,
    };
  }

  if (outsideHoursMatch) {
    return {
      outcome: "denied_outside_hours",
      subscription: outsideHoursMatch,
      daysLeft: Math.max(0, Math.ceil((outsideHoursMatch.endsAt.getTime() - nowMs) / 86_400_000)),
      sessionsAfter: outsideHoursMatch.sessionsRemaining,
      expiringSoon: false,
    };
  }

  if (noSessionsMatch) {
    return {
      outcome: "denied_no_sessions",
      subscription: noSessionsMatch,
      daysLeft: Math.max(0, Math.ceil((noSessionsMatch.endsAt.getTime() - nowMs) / 86_400_000)),
      sessionsAfter: 0,
      expiringSoon: false,
    };
  }

  if (latestExpired) {
    return {
      outcome: "denied_expired",
      subscription: latestExpired,
      daysLeft: 0,
      sessionsAfter: latestExpired.sessionsRemaining,
      expiringSoon: false,
    };
  }

  return {
    outcome: "denied_no_subscription",
    subscription: null,
    daysLeft: null,
    sessionsAfter: null,
    expiringSoon: false,
  };
}

export function calculateUnfreezeExtension(
  frozenAt: Date,
  unfreezeAt: Date,
  currentEndsAt: Date,
  currentTotalFrozenDays: number,
  maxFreezeDays?: number,
): { frozenDaysAdded: number; newEndsAt: Date; newTotalFrozenDays: number } {
  const diffMs = Math.max(0, unfreezeAt.getTime() - frozenAt.getTime());
  let frozenDaysAdded = Math.round(diffMs / 86_400_000);
  if (typeof maxFreezeDays === "number" && maxFreezeDays > 0) {
    const remainingBudget = Math.max(0, maxFreezeDays - currentTotalFrozenDays);
    frozenDaysAdded = Math.min(frozenDaysAdded, remainingBudget);
  }
  const newEndsAt = new Date(currentEndsAt.getTime() + frozenDaysAdded * 86_400_000);
  return {
    frozenDaysAdded,
    newEndsAt,
    newTotalFrozenDays: currentTotalFrozenDays + frozenDaysAdded,
  };
}
