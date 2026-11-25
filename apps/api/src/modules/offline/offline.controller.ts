import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { OfflineSyncDto } from "./dto/offline.dto";
import { OfflineService } from "./offline.service";

@ApiTags("Offline")
@ApiBearerAuth()
@Controller("offline")
export class OfflineController {
  constructor(private readonly offlineService: OfflineService) {}

  @Get("snapshot")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Download the 90-day offline snapshot (workouts, steps, weight, check-ins)" })
  getSnapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.offlineService.getSnapshot(user.userId);
  }

  @Post("sync")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Idempotently replay a single offline mutation (replaces sync_offline_entry RPC)" })
  sync(@CurrentUser() user: AuthenticatedUser, @Body() dto: OfflineSyncDto) {
    return this.offlineService.syncMutation(user.userId, dto);
  }
}
