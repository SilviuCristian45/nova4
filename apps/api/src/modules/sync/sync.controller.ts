import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SyncPushDto } from "./dto/sync.dto";
import { SyncService } from "./sync.service";

@ApiTags("Sync")
@ApiBearerAuth()
@Controller("sync")
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post("push")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Idempotently push a batch of mobile/offline mutations with LWW conflict resolution" })
  push(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncPushDto) {
    return this.syncService.push(user.userId, dto);
  }

  @Get("pull")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Pull full snapshot (cursor=0) or incremental delta changes since cursor" })
  @ApiQuery({ name: "cursor", required: false, type: Number, description: "Last seen sync sequence number (0 for initial full pull)" })
  pull(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string) {
    const parsed = cursor !== undefined && /^\d+$/.test(cursor.trim()) ? Number(cursor.trim()) : 0;
    const safeCursor = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    return this.syncService.pull(user.userId, safeCursor);
  }
}
