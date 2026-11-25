import { Body, Controller, Get, Patch, Put, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CoachGuard } from "../../common/guards/coach.guard";
import { setWeightUnitCookie } from "../auth/auth-cookies";
import { UpdateProfileDto, UpsertCoachProfileDto } from "./dto/profile.dto";
import { ProfilesService } from "./profiles.service";

@ApiTags("Profiles")
@ApiBearerAuth()
@Controller()
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly configService: ConfigService,
  ) {}

  @Get("profile")
  @ApiOperation({ summary: "Get the current user's profile" })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profilesService.getProfile(user.userId);
  }

  @Patch("profile")
  @ApiOperation({ summary: "Update the current user's profile settings" })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const updated = await this.profilesService.updateProfile(user.userId, dto);
    if (dto.weightUnit !== undefined) {
      setWeightUnitCookie(res, this.configService, updated.weightUnit);
    }
    return updated;
  }

  @Get("coach-profile")
  @UseGuards(CoachGuard)
  @ApiOperation({ summary: "Get the current coach's public profile" })
  getCoachProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profilesService.getCoachProfile(user.userId);
  }

  @Put("coach-profile")
  @UseGuards(CoachGuard)
  @ApiOperation({ summary: "Create or replace the current coach's profile" })
  putCoachProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertCoachProfileDto) {
    return this.profilesService.upsertCoachProfile(user.userId, dto);
  }

  @Patch("coach-profile")
  @UseGuards(CoachGuard)
  @ApiOperation({ summary: "Update the current coach's profile" })
  patchCoachProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertCoachProfileDto) {
    return this.profilesService.upsertCoachProfile(user.userId, dto);
  }
}
