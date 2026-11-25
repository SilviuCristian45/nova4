import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { CoachGuard } from "../../common/guards/coach.guard";
import { CloneMealPlanDto, SaveMealPlanDto, ToggleShareLinkDto } from "./dto/meal-plan.dto";
import { MealPlansService } from "./meal-plans.service";

@ApiTags("Coach Meal Plans")
@ApiBearerAuth()
@UseGuards(CoachGuard)
@Controller("coach/meal-plans")
export class CoachMealPlansController {
  constructor(private readonly mealPlansService: MealPlansService) {}

  @Get()
  @ApiOperation({ summary: "List coach's meal plans (templates and assigned plans)" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.mealPlansService.listCoachPlans(user.userId);
  }

  @Post()
  @ApiOperation({ summary: "Create a new meal plan" })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveMealPlanDto) {
    return this.mealPlansService.saveCoachPlan(user.userId, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get full meal plan structure" })
  getOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.mealPlansService.getCoachPlan(user.userId, id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update a meal plan transactionally" })
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SaveMealPlanDto) {
    return this.mealPlansService.saveCoachPlan(user.userId, dto, id);
  }

  @Post(":id/clone")
  @ApiOperation({ summary: "Clone a meal plan template for an active client" })
  clone(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CloneMealPlanDto,
  ) {
    return this.mealPlansService.clonePlanForClient(user.userId, id, dto.clientId);
  }

  @Post(":id/share-link")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Enable or revoke the public share link for a meal plan" })
  toggleShareLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ToggleShareLinkDto,
  ) {
    return this.mealPlansService.toggleShareLink(user.userId, id, dto.enable);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a meal plan" })
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.mealPlansService.deleteCoachPlan(user.userId, id);
  }
}

@ApiTags("Client Meal Plans")
@ApiBearerAuth()
@Controller("meals/plan")
export class ClientMealPlansController {
  constructor(private readonly mealPlansService: MealPlansService) {}

  @Get()
  @ApiOperation({ summary: "List active meal plans assigned to the current client" })
  listActive(@CurrentUser() user: AuthenticatedUser) {
    return this.mealPlansService.listClientActivePlans(user.userId);
  }

  @Post("meals/:mealId/log")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "1-click log a meal from an assigned plan into today's diary" })
  logMeal(@CurrentUser() user: AuthenticatedUser, @Param("mealId") mealId: string) {
    return this.mealPlansService.logPlanMealToday(user.userId, mealId);
  }

  @Post(":planId/apply-targets")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Apply an assigned meal plan's macro targets to user_targets" })
  applyTargets(@CurrentUser() user: AuthenticatedUser, @Param("planId") planId: string) {
    return this.mealPlansService.applyPlanTargets(user.userId, planId);
  }
}

@ApiTags("Public Meal Plans")
@Controller("public/meal-plans")
export class PublicMealPlansController {
  constructor(private readonly mealPlansService: MealPlansService) {}

  @Public()
  @Get(":token")
  @ApiOperation({ summary: "View a shared meal plan by revocable token (no auth, zero PII)" })
  getPublic(@Param("token") token: string) {
    return this.mealPlansService.getPublicByToken(token);
  }
}
