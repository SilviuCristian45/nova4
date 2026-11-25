import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateMealDto, CreateMealTemplateDto, UpsertUserTargetsDto } from "./dto/meal.dto";
import { MealsService } from "./meals.service";

@ApiTags("Meals")
@ApiBearerAuth()
@Controller("meals")
export class MealsController {
  constructor(private readonly mealsService: MealsService) {}

  @Get()
  @ApiOperation({ summary: "List meals with items and food metadata" })
  @ApiQuery({ name: "date", required: false })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  listMeals(
    @CurrentUser() user: AuthenticatedUser,
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.mealsService.listMeals(user.userId, { date, from, to });
  }

  @Post()
  @ApiOperation({ summary: "Log a complete meal transactionally" })
  createMeal(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMealDto) {
    return this.mealsService.createMeal(user.userId, dto);
  }

  @Get("templates")
  @ApiOperation({ summary: "List saved meal templates" })
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.mealsService.listTemplates(user.userId);
  }

  @Post("templates")
  @ApiOperation({ summary: "Create a saved meal template" })
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMealTemplateDto) {
    return this.mealsService.createTemplate(user.userId, dto);
  }

  @Delete("templates/:id")
  @ApiOperation({ summary: "Delete a saved meal template" })
  deleteTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.mealsService.deleteTemplate(user.userId, id);
  }

  @Get("targets")
  @ApiOperation({ summary: "Get daily macro targets and adaptive energy recommendation" })
  getTargets(@CurrentUser() user: AuthenticatedUser) {
    return this.mealsService.getTargets(user.userId);
  }

  @Put("targets")
  @ApiOperation({ summary: "Upsert daily calorie and macro targets" })
  upsertTargets(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertUserTargetsDto) {
    return this.mealsService.upsertTargets(user.userId, dto);
  }

  @Delete("items/:itemId")
  @ApiOperation({ summary: "Delete a single meal item" })
  deleteMealItem(@CurrentUser() user: AuthenticatedUser, @Param("itemId") itemId: string) {
    return this.mealsService.deleteMealItem(user.userId, itemId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a meal and its items" })
  deleteMeal(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.mealsService.deleteMeal(user.userId, id);
  }
}
