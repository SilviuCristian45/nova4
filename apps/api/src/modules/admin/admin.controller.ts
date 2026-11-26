import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SuperAdminGuard } from "../../common/guards/super-admin.guard";
import { AdminService } from "./admin.service";
import {
  AdminCreateUserDto,
  AdminResetPasswordDto,
  AdminSetUserStatusDto,
  AdminUpdateUserDto,
} from "./dto/admin-user.dto";

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller("admin/users")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "List all users with summary stats and optional filters (Super Admin only)" })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "role", required: false, enum: ["client", "coach"] })
  @ApiQuery({ name: "status", required: false, enum: ["active", "disabled"] })
  listUsers(
    @Query("q") q?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
  ) {
    return this.adminService.listUsers({ q, role, status });
  }

  @Post()
  @ApiOperation({ summary: "Create a new user account (bypasses DISABLE_SIGNUP, Super Admin only)" })
  createUser(@Body() dto: AdminCreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit user email, display name, role, weight unit, or steps goal (Super Admin only)" })
  updateUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.adminService.updateUser(actor.userId, id, dto);
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "Disable or re-enable a user account immediately (Super Admin only)" })
  setUserStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: AdminSetUserStatusDto,
  ) {
    return this.adminService.setUserStatus(actor.userId, id, dto.disabled);
  }

  @Post(":id/reset-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset a user password and revoke all active sessions (Super Admin only)" })
  resetPassword(@Param("id") id: string, @Body() dto: AdminResetPasswordDto) {
    return this.adminService.resetPassword(id, dto.newPassword);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Permanently delete a user account, S3 photos, and all cascaded data (Super Admin only)" })
  deleteUser(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.adminService.deleteUser(actor.userId, id);
  }
}
