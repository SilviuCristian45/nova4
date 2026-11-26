import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { DriveService } from "./drive.service";
import { DriveFileIdDto, SetDriveFrequencyDto } from "./dto/drive.dto";

const DRIVE_OAUTH_COOKIE = "replog_drive_oauth";

@ApiTags("Google Drive Backups")
@Controller("drive")
export class DriveController {
  constructor(
    private readonly driveService: DriveService,
    private readonly config: ConfigService,
  ) {}

  @Get("status")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get Google Drive backup connection status and schedule" })
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.driveService.getStatus(user.userId);
  }

  @Post("connect")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Start Google Drive OAuth PKCE flow and set state/verifier cookie" })
  connect(@Res({ passthrough: true }) res: Response) {
    const { state, verifier, url } = this.driveService.startConnect();
    const isProd = this.config.get<string>("NODE_ENV") === "production";
    const secure = this.config.get<string>("COOKIE_SECURE") === "true" || isProd;

    res.cookie(DRIVE_OAUTH_COOKIE, JSON.stringify({ state, verifier }), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
    });
    return { url };
  }

  @Get("callback")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Complete Google Drive OAuth callback" })
  async callback(
    @CurrentUser() user: AuthenticatedUser,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") oauthError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const rawCookie = cookies?.[DRIVE_OAUTH_COOKIE];
    res.clearCookie(DRIVE_OAUTH_COOKIE, { path: "/" });

    const wantsHtml = typeof req.headers.accept === "string" && req.headers.accept.includes("text/html");
    const redirectSettings = (status: string) => res.redirect(302, `/settings?drive=${status}#drive`);

    if (oauthError) {
      if (wantsHtml) return redirectSettings(oauthError === "access_denied" ? "cancelled" : "error");
      throw new BadRequestException(`Google OAuth error: ${oauthError}`);
    }

    if (!code || !state || typeof rawCookie !== "string") {
      if (wantsHtml) return redirectSettings("state");
      throw new BadRequestException("Invalid or expired Google OAuth callback");
    }

    let parsed: { state?: string; verifier?: string };
    try {
      parsed = JSON.parse(rawCookie) as { state?: string; verifier?: string };
    } catch {
      if (wantsHtml) return redirectSettings("state");
      throw new BadRequestException("Corrupted OAuth state cookie");
    }

    if (!parsed.state || !parsed.verifier || parsed.state !== state) {
      if (wantsHtml) return redirectSettings("state");
      throw new BadRequestException("OAuth state mismatch");
    }

    try {
      const status = await this.driveService.completeConnect(user.userId, code, parsed.verifier);
      if (wantsHtml) return redirectSettings("connected");
      return res.json(status);
    } catch (err) {
      if (wantsHtml) {
        const msg = err instanceof Error ? err.message : "";
        return redirectSettings(/scope/i.test(msg) ? "scope" : "error");
      }
      throw err;
    }
  }

  @Post("disconnect")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke Google Drive refresh token and disconnect backup link" })
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.driveService.removeDriveLink(user.userId);
    return { success: true };
  }

  @Put("frequency")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set automatic Google Drive backup frequency (off | daily | weekly | monthly)" })
  setFrequency(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetDriveFrequencyDto) {
    return this.driveService.setFrequency(user.userId, dto.frequency);
  }

  @Get("backups")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List JSON backups stored in Google Drive appDataFolder" })
  listBackups(@CurrentUser() user: AuthenticatedUser) {
    return this.driveService.listBackups(user.userId);
  }

  @Post("backup")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Run an immediate manual backup to Google Drive" })
  backupNow(@CurrentUser() user: AuthenticatedUser) {
    return this.driveService.backupUser(user.userId, true);
  }

  @Post("sync")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Run a backup to Google Drive if one is due" })
  syncIfDue(@CurrentUser() user: AuthenticatedUser) {
    return this.driveService.backupUser(user.userId, false);
  }

  @Get("download")
  @ApiBearerAuth()
  @Header("Content-Type", "application/json; charset=utf-8")
  @ApiOperation({ summary: "Download a JSON backup file from Google Drive" })
  download(@CurrentUser() user: AuthenticatedUser, @Query("fileId") fileId?: string) {
    if (!fileId?.trim()) throw new BadRequestException("fileId is required");
    return this.driveService.downloadBackup(user.userId, fileId.trim());
  }

  @Post("restore")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Restore account data and progress photos from a Google Drive backup" })
  restore(@CurrentUser() user: AuthenticatedUser, @Body() dto: DriveFileIdDto) {
    return this.driveService.restoreBackup(user.userId, dto.fileId);
  }

  @Public()
  @Post("cron")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Manually trigger due Google Drive backups (authorized via CRON_SECRET Bearer token)" })
  async triggerCron(@Headers("authorization") authorization?: string) {
    const secret = this.config.get<string>("CRON_SECRET")?.trim();
    const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

    if (!secret || !provided) {
      throw new UnauthorizedException("Invalid cron secret");
    }

    const a = Buffer.from(secret);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid cron secret");
    }

    return this.driveService.backupAllDue(50_000);
  }
}
