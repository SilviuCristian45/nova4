import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AUTH_COOKIES, type AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { clearSessionCookies, setAccessCookie, setSessionCookies } from "./auth-cookies";
import { AuthService, type SessionMeta } from "./auth.service";
import {
  ActivateCoachDto,
  ChangeEmailDto,
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
} from "./dto/auth.dto";

function requestMeta(req: Request): SessionMeta {
  const ua = req.headers["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua.slice(0, 500) : null,
    ipAddress: req.ip || null,
  };
}

function cookieRefreshToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const raw = cookies?.[AUTH_COOKIES.refresh];
  return typeof raw === "string" ? raw : undefined;
}

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @Post("register")
  @ApiOperation({ summary: "Register a new account (client or self-serve coach)" })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.register(dto, requestMeta(req));
    setSessionCookies(res, this.configService, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      weightUnit: session.user.profile.weightUnit,
    });
    return session;
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in with email and password (supports Argon2id and legacy bcrypt migration)" })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(dto, requestMeta(req));
    setSessionCookies(res, this.configService, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      weightUnit: session.user.profile.weightUnit,
    });
    return session;
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate refresh token and issue a fresh access token" })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = dto.refreshToken ?? cookieRefreshToken(req);
    const session = await this.authService.refresh(rawToken, requestMeta(req));
    setSessionCookies(res, this.configService, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      weightUnit: session.user.profile.weightUnit,
    });
    return session;
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke current refresh token and clear session cookies" })
  async logout(
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = dto.refreshToken ?? cookieRefreshToken(req);
    await this.authService.logout(rawToken);
    clearSessionCookies(res, this.configService);
    return { success: true };
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the currently authenticated user, profile, and coach profile" })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.userId);
  }

  @Patch("password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change password and revoke existing refresh sessions" })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(user.userId, dto);
    clearSessionCookies(res, this.configService);
    return result;
  }

  @Patch("email")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update account email address" })
  async changeEmail(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangeEmailDto) {
    return this.authService.changeEmail(user.userId, dto);
  }

  @Post("activate-coach")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Activate Coach role on the current account (replaces activate_coach_role RPC)" })
  async activateCoach(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActivateCoachDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.activateCoachRole(user.userId, dto);
    setAccessCookie(res, this.configService, result.accessToken);
    return result;
  }
}
