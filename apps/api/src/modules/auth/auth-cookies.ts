import { ConfigService } from "@nestjs/config";
import type { CookieOptions, Response } from "express";
import type { WeightUnit } from "@replog/shared";
import { AUTH_COOKIES } from "../../common/auth/auth-user.type";

function baseCookieOptions(config: ConfigService): CookieOptions {
  const secureFlag = config.get<string>("COOKIE_SECURE");
  const isProd = config.get<string>("NODE_ENV") === "production";
  const secure = secureFlag !== undefined ? secureFlag === "true" : isProd;
  const domain = config.get<string>("COOKIE_DOMAIN")?.trim() || undefined;

  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function setAccessCookie(res: Response, config: ConfigService, accessToken: string): void {
  const ttlSeconds = Number(config.get<string>("JWT_ACCESS_TTL_SECONDS") ?? 900);
  res.cookie(AUTH_COOKIES.access, accessToken, {
    ...baseCookieOptions(config),
    maxAge: ttlSeconds * 1000,
  });
}

export function setRefreshCookie(res: Response, config: ConfigService, refreshToken: string): void {
  const ttlDays = Number(config.get<string>("REFRESH_TOKEN_TTL_DAYS") ?? 30);
  res.cookie(AUTH_COOKIES.refresh, refreshToken, {
    ...baseCookieOptions(config),
    maxAge: ttlDays * 24 * 60 * 60 * 1000,
  });
}

export function setWeightUnitCookie(res: Response, config: ConfigService, weightUnit: WeightUnit): void {
  const base = baseCookieOptions(config);
  res.cookie(AUTH_COOKIES.weightUnit, weightUnit, {
    ...base,
    httpOnly: false,
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

export function setSessionCookies(
  res: Response,
  config: ConfigService,
  tokens: { accessToken: string; refreshToken: string; weightUnit: WeightUnit },
): void {
  setAccessCookie(res, config, tokens.accessToken);
  setRefreshCookie(res, config, tokens.refreshToken);
  setWeightUnitCookie(res, config, tokens.weightUnit);
}

export function clearSessionCookies(res: Response, config: ConfigService): void {
  const base = baseCookieOptions(config);
  res.clearCookie(AUTH_COOKIES.access, base);
  res.clearCookie(AUTH_COOKIES.refresh, base);
}
