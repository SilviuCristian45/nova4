import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { NotificationsService } from "./notifications.service";

@ApiTags("Notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List recent in-app notifications for the current user" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  list(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: number) {
    return this.notificationsService.list(user.userId, limit);
  }

  @Get("unread")
  @ApiOperation({ summary: "Get unread notification count" })
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.userId);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark all notifications as read" })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark a single notification as read" })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a notification" })
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notificationsService.remove(user.userId, id);
  }
}
