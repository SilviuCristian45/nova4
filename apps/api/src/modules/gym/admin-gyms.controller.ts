import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SuperAdminGuard } from "../../common/guards/super-admin.guard";
import { AdminCreateGymDto, AdminUpdateGymDto } from "./dto/gym.dto";
import { GymService } from "./gym.service";

@ApiTags("Admin Gyms")
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller("admin/gyms")
export class AdminGymsController {
  constructor(private readonly gymService: GymService) {}

  @Get()
  @ApiOperation({ summary: "List all gyms with member, staff, and subscription stats (Super Admin only)" })
  listGyms() {
    return this.gymService.listGymsAdmin();
  }

  @Post()
  @ApiOperation({ summary: "Create a new gym and optionally assign an owner (Super Admin only)" })
  createGym(@CurrentUser() actor: AuthenticatedUser, @Body() dto: AdminCreateGymDto) {
    return this.gymService.createGymAdmin(actor.userId, dto);
  }

  @Patch(":gymId")
  @ApiOperation({ summary: "Update or deactivate a gym (Super Admin only)" })
  updateGym(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: AdminUpdateGymDto,
  ) {
    return this.gymService.updateGymAdmin(actor.userId, gymId, dto);
  }
}
