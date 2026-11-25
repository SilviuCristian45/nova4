import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateWorkoutDto, SaveWorkoutDraftDto, UpdateWorkoutDto } from "./dto/workout.dto";
import { WorkoutsService } from "./workouts.service";

@ApiTags("Workouts")
@ApiBearerAuth()
@Controller("workouts")
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get()
  @ApiOperation({ summary: "List workouts for the current user" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "mode", required: false, enum: ["strength", "cardio"] })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("mode") mode?: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    return this.workoutsService.list(user.userId, { from, to, mode, limit, offset });
  }

  @Post()
  @ApiOperation({ summary: "Create a workout transactionally with PR detection and coach notification" })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkoutDto) {
    return this.workoutsService.create(user.userId, dto);
  }

  @Get("draft")
  @ApiOperation({ summary: "Get the current user's active workout draft" })
  getDraft(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutsService.getDraft(user.userId);
  }

  @Put("draft")
  @ApiOperation({ summary: "Save workout draft with client timestamp conflict protection" })
  saveDraft(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveWorkoutDraftDto) {
    return this.workoutsService.saveDraft(user.userId, dto);
  }

  @Delete("draft")
  @ApiOperation({ summary: "Delete the current user's workout draft" })
  deleteDraft(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutsService.deleteDraft(user.userId);
  }

  @Get("records")
  @ApiOperation({ summary: "Get all-time personal records per exercise" })
  getRecords(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutsService.getRecords(user.userId);
  }

  @Get("stats")
  @ApiOperation({ summary: "Get workout stats and optional exercise strength progression" })
  @ApiQuery({ name: "exercise", required: false })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  getStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query("exercise") exercise?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.workoutsService.getStats(user.userId, { exercise, from, to });
  }

  @Get("exercises/:exercise/history")
  @ApiOperation({ summary: "Get last session, all-time PR, and plateau detection for an exercise" })
  getExerciseHistory(@CurrentUser() user: AuthenticatedUser, @Param("exercise") exercise: string) {
    return this.workoutsService.getExerciseHistory(user.userId, exercise);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single workout by ID" })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.workoutsService.findOne(user.userId, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a workout transactionally preserving existing set IDs" })
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateWorkoutDto) {
    return this.workoutsService.update(user.userId, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a workout and its sets/cardio" })
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.workoutsService.remove(user.userId, id);
  }
}
