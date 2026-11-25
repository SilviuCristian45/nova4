import type { UserRole } from "@replog/shared";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export const AUTH_COOKIES = {
  access: "replog_access_token",
  refresh: "replog_refresh_token",
  weightUnit: "weight_unit",
} as const;
