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
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Observable } from "rxjs";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { GymRoles } from "../../common/decorators/gym-roles.decorator";
import { GymStaffGuard } from "../../common/guards/gym-staff.guard";
import {
  CancelSubscriptionDto,
  CreateMemberDto,
  CreatePlanDto,
  CreateSubscriptionDto,
  FreezeSubscriptionDto,
  ManualCheckinDto,
  ScanCheckinDto,
  UpdateGymSettingsDto,
  UpdateMemberDto,
  UpdatePlanDto,
  UpsertGymStaffDto,
} from "./dto/gym.dto";
import { GymSseService } from "./gym-sse.service";
import { GymService } from "./gym.service";

@ApiTags("Gym")
@ApiBearerAuth()
@Controller("gym")
export class GymController {
  constructor(
    private readonly gymService: GymService,
    private readonly sseService: GymSseService,
  ) {}

  // =========================================================================
  // Member / Client endpoints
  // =========================================================================

  @Get("my")
  @ApiOperation({ summary: "Get gyms where current user is a member or staff" })
  getMyGyms(@CurrentUser() user: AuthenticatedUser) {
    return this.gymService.getMyGyms(user.userId);
  }

  @Get("my/checkins")
  @ApiOperation({ summary: "Get current user's gym check-in history" })
  @ApiQuery({ name: "limit", required: false })
  getMyCheckins(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    return this.gymService.getMyCheckins(user.userId, limit ? Number(limit) : 50);
  }

  @Post("checkins/scan")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Scan a gym QR code to validate subscription and record check-in" })
  scanCheckin(@CurrentUser() user: AuthenticatedUser, @Body() dto: ScanCheckinDto) {
    return this.gymService.scanCheckin(user.userId, dto);
  }

  // =========================================================================
  // Gym Staff / Reception endpoints
  // =========================================================================

  @Sse(":gymId/checkins/stream")
  @SkipThrottle()
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Live Server-Sent Events stream of gym check-ins for reception" })
  streamCheckins(@Param("gymId") gymId: string): Observable<MessageEvent> {
    return this.sseService.subscribe(gymId);
  }

  @Get(":gymId/checkins")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Get daily check-in KPIs and filtered check-in feed" })
  @ApiQuery({ name: "date", required: false })
  @ApiQuery({ name: "outcome", required: false })
  @ApiQuery({ name: "q", required: false })
  getCheckins(
    @Param("gymId") gymId: string,
    @Query("date") date?: string,
    @Query("outcome") outcome?: string,
    @Query("q") q?: string,
  ) {
    return this.gymService.getCheckinsDashboard(gymId, { date, outcome, q });
  }

  @Post(":gymId/checkins/manual")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Manual check-in / override by reception with audited reason" })
  manualCheckin(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: ManualCheckinDto,
  ) {
    return this.gymService.manualCheckin(gymId, actor.userId, dto);
  }

  @Get(":gymId/qr")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "Get gym QR token and printable check-in URL" })
  getQr(@Param("gymId") gymId: string) {
    return this.gymService.getQrInfo(gymId);
  }

  @Post(":gymId/qr/rotate")
  @HttpCode(HttpStatus.OK)
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "Rotate gym QR token immediately invalidating previous posters" })
  rotateQr(@CurrentUser() actor: AuthenticatedUser, @Param("gymId") gymId: string) {
    return this.gymService.rotateQr(gymId, actor.userId);
  }

  @Patch(":gymId/settings")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "Update gym settings (timezone, cooldown, capacity, optional GPS)" })
  updateSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: UpdateGymSettingsDto,
  ) {
    return this.gymService.updateSettings(gymId, actor.userId, dto);
  }

  @Get(":gymId/staff")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "List gym staff members" })
  listStaff(@Param("gymId") gymId: string) {
    return this.gymService.listStaff(gymId);
  }

  @Post(":gymId/staff")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner")
  @ApiOperation({ summary: "Add or update gym staff member role (owner only)" })
  upsertStaff(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: UpsertGymStaffDto,
  ) {
    return this.gymService.upsertStaff(gymId, actor.userId, dto);
  }

  @Delete(":gymId/staff/:userId")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner")
  @ApiOperation({ summary: "Remove staff member from gym (owner only)" })
  removeStaff(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Param("userId") targetUserId: string,
  ) {
    return this.gymService.removeStaff(gymId, actor.userId, targetUserId);
  }

  @Get(":gymId/plans")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "List gym membership plans" })
  listPlans(@Param("gymId") gymId: string) {
    return this.gymService.listPlans(gymId);
  }

  @Post(":gymId/plans")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "Create a membership plan (owner/manager)" })
  createPlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: CreatePlanDto,
  ) {
    return this.gymService.createPlan(gymId, actor.userId, dto);
  }

  @Patch(":gymId/plans/:planId")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "Update a membership plan (owner/manager)" })
  updatePlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Param("planId") planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.gymService.updatePlan(gymId, actor.userId, planId, dto);
  }

  @Get(":gymId/members")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "List gym members with active subscriptions" })
  @ApiQuery({ name: "q", required: false })
  listMembers(@Param("gymId") gymId: string, @Query("q") q?: string) {
    return this.gymService.listMembers(gymId, q);
  }

  @Post(":gymId/members")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Enroll existing user by email or create new RepLog account + member" })
  createMember(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: CreateMemberDto,
  ) {
    return this.gymService.createMember(gymId, actor.userId, dto);
  }

  @Patch(":gymId/members/:memberId")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Update member contact details, notes, or active/suspended status" })
  updateMember(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.gymService.updateMember(gymId, actor.userId, memberId, dto);
  }

  @Post(":gymId/subscriptions")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Activate or renew a member subscription and optionally record payment" })
  createSubscription(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.gymService.createSubscription(gymId, actor.userId, dto);
  }

  @Post(":gymId/subscriptions/:subId/freeze")
  @HttpCode(HttpStatus.OK)
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Freeze an active subscription within plan freeze allowance" })
  freezeSubscription(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Param("subId") subId: string,
    @Body() dto: FreezeSubscriptionDto,
  ) {
    return this.gymService.freezeSubscription(gymId, actor.userId, subId, dto);
  }

  @Post(":gymId/subscriptions/:subId/unfreeze")
  @HttpCode(HttpStatus.OK)
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Unfreeze subscription and automatically extend ends_at" })
  unfreezeSubscription(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Param("subId") subId: string,
  ) {
    return this.gymService.unfreezeSubscription(gymId, actor.userId, subId);
  }

  @Post(":gymId/subscriptions/:subId/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "Cancel a subscription" })
  cancelSubscription(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("gymId") gymId: string,
    @Param("subId") subId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.gymService.cancelSubscription(gymId, actor.userId, subId, dto);
  }

  @Get(":gymId/payments")
  @UseGuards(GymStaffGuard)
  @ApiOperation({ summary: "List payments and totals by payment method" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "method", required: false })
  listPayments(
    @Param("gymId") gymId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("method") method?: string,
  ) {
    return this.gymService.listPayments(gymId, { from, to, method });
  }

  @Get(":gymId/audit")
  @UseGuards(GymStaffGuard)
  @GymRoles("owner", "manager")
  @ApiOperation({ summary: "View gym audit log (owner/manager)" })
  @ApiQuery({ name: "limit", required: false })
  listAuditLogs(@Param("gymId") gymId: string, @Query("limit") limit?: string) {
    return this.gymService.listAuditLogs(gymId, limit ? Number(limit) : 100);
  }
}
