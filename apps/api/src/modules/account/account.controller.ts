import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Post, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { clearSessionCookies } from "../auth/auth-cookies";
import { AccountService } from "./account.service";
import { ConfirmEmailDto, ImportAccountDataDto } from "./dto/account.dto";

@ApiTags("Account & GDPR")
@ApiBearerAuth()
@Controller("account")
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly configService: ConfigService,
  ) {}

  @Get("export")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Export all user data in replog-export v1 GDPR JSON format" })
  exportData(@CurrentUser() user: AuthenticatedUser) {
    return this.accountService.buildExport(user.userId);
  }

  @Post("import")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Import a replog-export v1 JSON payload transactionally" })
  async importData(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportAccountDataDto) {
    const counts = await this.accountService.importData(user.userId, dto.data);
    return { success: true, counts };
  }

  @Delete("data")
  @ApiOperation({ summary: "Delete all logged user data and S3 photos while keeping the account" })
  deleteAllData(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmEmailDto) {
    return this.accountService.deleteAllData(user.userId, dto.confirmEmail);
  }

  @Delete()
  @ApiOperation({ summary: "Permanently delete S3 photos, account, and all cascaded user data" })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.accountService.deleteAccount(user.userId, dto.confirmEmail);
    clearSessionCookies(res, this.configService);
    return result;
  }
}
