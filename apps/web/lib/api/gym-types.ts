import type {
  GymCheckinMethod,
  GymCheckinOutcome,
  GymMemberStatus,
  GymPaymentMethod,
  GymPlanType,
  GymStaffRole,
  GymSubscriptionStatus,
} from "@replog/shared";

export interface ApiAdminGym {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  timezone: string;
  currency: string;
  capacity: number | null;
  checkinCooldownMinutes: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  membersCount: number;
  staffCount: number;
  activeSubscriptionsCount: number;
  ownerEmails: string[];
}

export interface ApiMyGymSubscription {
  id: string;
  planName: string;
  planType: GymPlanType;
  status: GymSubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  sessionsTotal: number | null;
  sessionsRemaining: number | null;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  allowedDaysMask: number;
  frozenAt: string | null;
  frozenUntil: string | null;
  totalFrozenDays: number;
}

export interface ApiMyGymMembership {
  memberId: string;
  gymId: string;
  gymName: string;
  gymSlug: string;
  gymAddress: string | null;
  gymTimezone: string;
  gymCurrency: string;
  gymCapacity: number | null;
  gymIsActive: boolean;
  requiresLocation: boolean;
  activeInGymNow: number;
  memberCode: string;
  memberStatus: GymMemberStatus;
  joinedAt: string | null;
  subscription: ApiMyGymSubscription | null;
  recentCheckins: {
    id: string;
    checkedInAt: string | null;
    method: GymCheckinMethod;
    outcome: GymCheckinOutcome;
    sessionsAfter: number | null;
  }[];
}

export interface ApiStaffGym {
  gymId: string;
  role: GymStaffRole;
  gymName: string;
  gymSlug: string;
  gymAddress: string | null;
  gymTimezone: string;
  gymCurrency: string;
  gymCapacity: number | null;
  checkinCooldownMinutes: number;
  latitude: number | null;
  longitude: number | null;
  checkinRadiusMeters: number | null;
  isActive: boolean;
}

export interface ApiMyGymsResponse {
  memberships: ApiMyGymMembership[];
  staffGyms: ApiStaffGym[];
}

export interface ApiScanCheckinResponse {
  checkinId: string | null;
  gymId: string | null;
  gymName: string | null;
  checkedInAt: string;
  outcome: GymCheckinOutcome;
  memberId: string | null;
  memberName: string | null;
  memberCode: string | null;
  planName: string | null;
  planType: GymPlanType | null;
  daysLeft: number | null;
  endsAt: string | null;
  sessionsAfter: number | null;
  sessionsTotal: number | null;
  frozenUntil: string | null;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  recentCheckinTime: string | null;
  expiringSoon: boolean;
  gpsRejected: boolean;
  distanceMeters: number | null;
}

export interface ApiGymCheckinEvent {
  checkinId: string;
  gymId: string;
  checkedInAt: string;
  method: GymCheckinMethod;
  outcome: GymCheckinOutcome;
  memberId: string | null;
  userId: string;
  memberName: string;
  memberEmail: string;
  memberCode: string | null;
  planName: string | null;
  planType: GymPlanType | null;
  daysLeft: number | null;
  endsAt: string | null;
  sessionsAfter: number | null;
  sessionsTotal: number | null;
  expiringSoon: boolean;
  overrideReason: string | null;
  frozenUntil: string | null;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  gpsRejected: boolean;
}

export interface ApiGymCheckinsDashboard {
  date: string;
  stats: {
    todayTotal: number;
    todayAllowed: number;
    todayDenied: number;
    uniqueToday: number;
    inGymNow: number;
    activeSubscriptions: number;
    expiringSoonCount: number;
  };
  items: ApiGymCheckinEvent[];
}

export interface ApiGymPlan {
  id: string;
  gymId: string;
  name: string;
  description: string | null;
  planType: GymPlanType;
  durationDays: number;
  sessionCount: number | null;
  priceCents: number;
  currency: string;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  allowedDaysMask: number;
  maxFreezeDays: number;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiGymMemberSubscription {
  id: string;
  planId: string | null;
  planName: string;
  planType: GymPlanType;
  status: GymSubscriptionStatus;
  startsAt: string | null;
  endsAt: string;
  daysLeft: number;
  sessionsTotal: number | null;
  sessionsRemaining: number | null;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  allowedDaysMask: number;
  maxFreezeDays: number;
  frozenAt: string | null;
  frozenUntil: string | null;
  totalFrozenDays: number;
}

export interface ApiGymMember {
  id: string;
  gymId: string;
  userId: string;
  email: string;
  displayName: string | null;
  memberCode: string;
  phone: string | null;
  emergencyContact: string | null;
  notes: string | null;
  status: GymMemberStatus;
  joinedAt: string | null;
  lastCheckinAt: string | null;
  activeSubscription: ApiGymMemberSubscription | null;
  subscriptions: ApiGymMemberSubscription[];
}

export interface ApiGymQrInfo {
  gymId: string;
  gymName: string;
  gymAddress: string | null;
  qrToken: string;
  checkinPath: string;
  checkinUrl: string;
  qrRotatedAt: string;
}

export interface ApiGymStaffMember {
  gymId: string;
  userId: string;
  role: GymStaffRole;
  email: string;
  displayName: string | null;
  createdAt: string | null;
}

export interface ApiGymPaymentsResponse {
  totals: {
    count: number;
    grandTotalCents: number;
    byMethod: Record<GymPaymentMethod, number>;
  };
  items: {
    id: string;
    subscriptionId: string | null;
    userId: string | null;
    memberName: string | null;
    memberEmail: string | null;
    planName: string | null;
    amountCents: number;
    currency: string;
    method: GymPaymentMethod;
    reference: string | null;
    note: string | null;
    recordedByName: string | null;
    paidAt: string | null;
  }[];
}

export interface ApiGymAuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  actorName: string;
  createdAt: string | null;
}
