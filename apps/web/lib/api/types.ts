import type { UserRole, WeightUnit } from "@replog/shared";

export const AUTH_COOKIES = {
  access: "replog_access_token",
  refresh: "replog_refresh_token",
  weightUnit: "weight_unit",
} as const;

export interface ApiProfile {
  id: string;
  role: UserRole;
  displayName: string | null;
  heightCm: number | null;
  birthDate: string | null;
  sex: "male" | "female" | null;
  weightUnit: WeightUnit;
  dailyStepsGoal: number;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "very_active" | null;
  goalKgPerWeek: number;
}

export interface ApiCoachProfile {
  userId: string;
  displayName: string;
  bio: string | null;
  specialties: string[];
  isPublic: boolean;
  acceptingClients: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiAuthUser {
  id: string;
  email: string;
  isSuperAdmin?: boolean;
  createdAt: string;
  profile: ApiProfile;
  coachProfile: ApiCoachProfile | null;
}

export interface ApiAdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  weightUnit: WeightUnit;
  dailyStepsGoal: number;
  disabled: boolean;
  disabledAt: string | null;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  workoutsCount: number;
  mealsCount: number;
  photosCount: number;
}

export interface ApiAdminUserListResponse {
  stats: {
    total: number;
    active: number;
    disabled: number;
    coaches: number;
    clients: number;
  };
  items: ApiAdminUser[];
}

export interface ApiAuthSession {
  user: ApiAuthUser;
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function extractApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const msg = (body as { message?: unknown; error?: unknown }).message;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (Array.isArray(msg) && msg.length > 0) {
    const joined = msg.filter((x): x is string => typeof x === "string").join("; ");
    if (joined) return joined;
  }
  const err = (body as { error?: unknown }).error;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}
