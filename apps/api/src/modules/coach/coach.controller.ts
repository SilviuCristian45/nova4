import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { RequireNutritionShare } from "../../common/decorators/coach-access.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ActiveCoachAccessGuard } from "../../common/guards/active-coach-access.guard";
import { CoachGuard } from "../../common/guards/coach.guard";
import { CoachService } from "./coach.service";
import {
  AddWorkoutFeedbackDto,
  AssignProgramDto,
  ClientEnrollmentStatusDto,
  CloneProgramForClientDto,
  EnrollInProgramDto,
  RequestCheckinPhotoUploadDto,
  RespondEnrollmentDto,
  ReviewWeeklyCheckinDto,
  SaveCoachNoteDto,
  SaveProgramDto,
  SubmitWeeklyCheckinDto,
  ToggleNutritionShareDto,
  UpdateEnrollmentStatusDto,
  UpdateEnrollmentWeekDto,
} from "./dto/coach.dto";

@ApiTags("Coach")
@ApiBearerAuth()
@UseGuards(CoachGuard)
@Controller("coach")
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Coach dashboard summary (active/inactive clients, pending requests, unreviewed check-ins)" })
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.coachService.getDashboard(user.userId);
  }

  @Get("programs")
  @ApiOperation({ summary: "List programs authored by the current coach" })
  listPrograms(@CurrentUser() user: AuthenticatedUser) {
    return this.coachService.listCoachPrograms(user.userId);
  }

  @Post("programs")
  @ApiOperation({ summary: "Create a new training program" })
  createProgram(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveProgramDto) {
    return this.coachService.saveProgram(user.userId, dto);
  }

  @Get("programs/:id")
  @ApiOperation({ summary: "Get full program structure with workouts, exercises, and cardio" })
  getProgram(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.coachService.getCoachProgram(user.userId, id);
  }

  @Put("programs/:id")
  @ApiOperation({ summary: "Update a program preserving existing program_workout IDs" })
  updateProgram(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SaveProgramDto) {
    return this.coachService.saveProgram(user.userId, dto, id);
  }

  @Post("programs/:id/invite-code")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Regenerate a unique invite code for a program" })
  regenerateInvite(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.coachService.regenerateInviteCode(user.userId, id);
  }

  @Post("programs/:id/clone")
  @ApiOperation({ summary: "Clone a program template exclusively for an active client" })
  cloneProgram(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CloneProgramForClientDto,
  ) {
    return this.coachService.cloneProgramForClient(user.userId, id, dto.clientId);
  }

  @Delete("programs/:id")
  @ApiOperation({ summary: "Delete a program" })
  deleteProgram(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.coachService.deleteProgram(user.userId, id);
  }

  @Get("clients")
  @ApiOperation({ summary: "List coach's client enrollments with adherence status" })
  listClients(@CurrentUser() user: AuthenticatedUser) {
    return this.coachService.listCoachClients(user.userId);
  }

  @Get("clients/:clientId")
  @UseGuards(ActiveCoachAccessGuard)
  @ApiOperation({ summary: "Get an active client's workouts, metrics, weekly check-ins, and coach note" })
  @ApiQuery({ name: "range", required: false })
  getClientDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("clientId") clientId: string,
    @Query("range") range?: string,
  ) {
    return this.coachService.getClientDetail(user.userId, clientId, range);
  }

  @Get("clients/:clientId/nutrition")
  @UseGuards(ActiveCoachAccessGuard)
  @RequireNutritionShare()
  @ApiOperation({ summary: "Get an active client's nutrition summary (requires share_nutrition = true)" })
  @ApiQuery({ name: "range", required: false })
  getClientNutrition(@Param("clientId") clientId: string, @Query("range") range?: string) {
    return this.coachService.getClientNutrition(clientId, range);
  }

  @Put("clients/:clientId/note")
  @UseGuards(ActiveCoachAccessGuard)
  @ApiOperation({ summary: "Save private coach note for an active client" })
  saveNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("clientId") clientId: string,
    @Body() dto: SaveCoachNoteDto,
  ) {
    return this.coachService.saveCoachNote(user.userId, clientId, dto.note);
  }

  @Post("enrollments/:id/respond")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve or reject a pending client enrollment request" })
  respondEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: RespondEnrollmentDto,
  ) {
    return this.coachService.respondEnrollment(user.userId, id, dto.decision);
  }

  @Patch("enrollments/:id/status")
  @ApiOperation({ summary: "Update an enrollment status (active | paused | completed)" })
  updateEnrollmentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateEnrollmentStatusDto,
  ) {
    return this.coachService.updateEnrollmentStatus(user.userId, id, dto.status);
  }

  @Patch("enrollments/:id/week")
  @ApiOperation({ summary: "Update an enrollment's current week (1-52)" })
  updateEnrollmentWeek(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateEnrollmentWeekDto,
  ) {
    return this.coachService.updateEnrollmentWeek(user.userId, id, dto.currentWeek);
  }

  @Post("enrollments/:id/assign-program")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Assign a coach-owned program to an enrollment" })
  assignProgram(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: AssignProgramDto,
  ) {
    return this.coachService.assignProgramToEnrollment(user.userId, id, dto.programId);
  }
}

@ApiTags("Explore")
@ApiBearerAuth()
@Controller("explore")
export class ExploreController {
  constructor(private readonly coachService: CoachService) {}

  @Get("programs")
  @ApiOperation({ summary: "Browse published public training programs" })
  listPublicPrograms() {
    return this.coachService.listPublicPrograms();
  }

  @Get("coaches")
  @ApiOperation({ summary: "Browse public coach profiles" })
  listPublicCoaches() {
    return this.coachService.listPublicCoaches();
  }

  @Get("invite/:code")
  @ApiOperation({ summary: "Preview a published program by invite code" })
  previewInvite(@Param("code") code: string) {
    return this.coachService.previewProgramByInvite(code);
  }

  @Post("enroll")
  @ApiOperation({ summary: "Enroll in a public or invite-only program" })
  enroll(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnrollInProgramDto) {
    return this.coachService.enrollInProgram(user.userId, dto);
  }

  @Get("enrollments")
  @ApiOperation({ summary: "List current user's enrollments as a client" })
  listEnrollments(@CurrentUser() user: AuthenticatedUser) {
    return this.coachService.listClientEnrollments(user.userId);
  }

  @Get("active-program")
  @ApiOperation({ summary: "Get active program workout summary for the current client dashboard" })
  activeProgram(@CurrentUser() user: AuthenticatedUser) {
    return this.coachService.getActiveProgramSummary(user.userId);
  }

  @Get("program-workouts/:id")
  @ApiOperation({ summary: "Get an assigned program workout's exercises and cardio targets" })
  getProgramWorkout(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.coachService.getProgramWorkoutForClient(user.userId, id);
  }

  @Delete("enrollments/:id")
  @ApiOperation({ summary: "Cancel a pending enrollment" })
  cancelPending(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.coachService.cancelPendingEnrollment(user.userId, id);
  }

  @Patch("enrollments/:id/nutrition")
  @ApiOperation({ summary: "Toggle nutrition sharing with the coach for an enrollment" })
  toggleNutrition(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ToggleNutritionShareDto,
  ) {
    return this.coachService.toggleEnrollmentNutrition(user.userId, id, dto.shareNutrition);
  }

  @Patch("enrollments/:id/status")
  @ApiOperation({ summary: "Pause or complete an enrollment as a client" })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ClientEnrollmentStatusDto,
  ) {
    return this.coachService.updateClientEnrollmentStatus(user.userId, id, dto.status);
  }
}

@ApiTags("Feedback")
@ApiBearerAuth()
@Controller("feedback")
export class FeedbackController {
  constructor(private readonly coachService: CoachService) {}

  @Get("workouts/:workoutId")
  @ApiOperation({ summary: "List workout feedback thread (owner or active coach)" })
  list(@CurrentUser() user: AuthenticatedUser, @Param("workoutId") workoutId: string) {
    return this.coachService.listWorkoutFeedback(user.userId, workoutId);
  }

  @Post("workouts/:workoutId")
  @ApiOperation({ summary: "Add feedback and optional reaction to a workout" })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workoutId") workoutId: string,
    @Body() dto: AddWorkoutFeedbackDto,
  ) {
    return this.coachService.addWorkoutFeedback(user.userId, workoutId, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete own feedback message" })
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.coachService.deleteWorkoutFeedback(user.userId, id);
  }
}

@ApiTags("Weekly Check-ins")
@ApiBearerAuth()
@Controller("checkins/weekly")
export class WeeklyCheckinsController {
  constructor(private readonly coachService: CoachService) {}

  @Get()
  @ApiOperation({ summary: "List current user's weekly check-ins with signed photo URLs" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.coachService.listClientWeeklyCheckins(user.userId);
  }

  @Post("photo-upload-url")
  @ApiOperation({ summary: "Request an upload URL for a weekly check-in photo (encrypted API endpoint when PHOTO_ENCRYPTION_KEY is set)" })
  requestPhotoUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestCheckinPhotoUploadDto) {
    return this.coachService.requestCheckinPhotoUploadUrl(user.userId, dto.sizeBytes);
  }

  @Put("photo-upload/:id")
  @ApiConsumes("image/jpeg")
  @ApiOperation({ summary: "Upload a weekly check-in JPEG photo to be AES-256-GCM encrypted at rest in S3/MinIO" })
  uploadPhotoFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    return this.coachService.uploadCheckinPhotoFile(user.userId, id, req.body);
  }

  @Get(":id/photo/:slot")
  @ApiOperation({ summary: "Stream a decrypted weekly check-in photo (strictly client or their currently active coach)" })
  async getPhotoFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("slot") slot: string,
    @Res() res: Response,
  ) {
    const bytes = await this.coachService.getCheckinPhotoFile(user.userId, id, slot);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300, no-transform");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  }

  @Post()
  @ApiOperation({ summary: "Submit or update current week's check-in for an active coach" })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitWeeklyCheckinDto) {
    return this.coachService.submitWeeklyCheckin(user.userId, dto);
  }

  @Post(":id/review")
  @HttpCode(HttpStatus.OK)
  @UseGuards(CoachGuard)
  @ApiOperation({ summary: "Coach reviews a client's weekly check-in (replaces review_weekly_checkin RPC)" })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ReviewWeeklyCheckinDto,
  ) {
    return this.coachService.reviewWeeklyCheckin(user.userId, id, dto);
  }
}
