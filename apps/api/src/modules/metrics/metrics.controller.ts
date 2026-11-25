import { Body, Controller, Delete, Get, Param, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UpsertDailyCheckinDto, UpsertStepsDto, UpsertWeightDto } from "./dto/metrics.dto";
import { MetricsService } from "./metrics.service";

@ApiTags("Metrics")
@ApiBearerAuth()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get("steps")
  @ApiOperation({ summary: "Get daily steps entries for the current user" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "date", required: false })
  listSteps(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("date") date?: string,
  ) {
    return this.metricsService.listSteps(user.userId, { from, to, date });
  }

  @Put("steps")
  @ApiOperation({ summary: "Upsert daily steps for a date" })
  upsertSteps(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertStepsDto) {
    return this.metricsService.upsertSteps(user.userId, dto);
  }

  @Get("weight")
  @ApiOperation({ summary: "Get daily body weight entries (kg) for the current user" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "date", required: false })
  listWeight(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("date") date?: string,
  ) {
    return this.metricsService.listWeight(user.userId, { from, to, date });
  }

  @Put("weight")
  @ApiOperation({ summary: "Upsert daily body weight (kg) for a date" })
  upsertWeight(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertWeightDto) {
    return this.metricsService.upsertWeight(user.userId, dto);
  }

  @Delete("weight/:date")
  @ApiOperation({ summary: "Delete a daily body weight entry" })
  deleteWeight(@CurrentUser() user: AuthenticatedUser, @Param("date") date: string) {
    return this.metricsService.deleteWeight(user.userId, date);
  }

  @Get("checkin")
  @ApiOperation({ summary: "Get daily check-in entries (energy, satiety, sleep, note)" })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "date", required: false })
  listCheckin(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("date") date?: string,
  ) {
    return this.metricsService.listCheckin(user.userId, { from, to, date });
  }

  @Put("checkin")
  @ApiOperation({ summary: "Upsert daily check-in for a date" })
  upsertCheckin(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertDailyCheckinDto) {
    return this.metricsService.upsertCheckin(user.userId, dto);
  }

  @Delete("checkin/:date")
  @ApiOperation({ summary: "Delete a daily check-in entry" })
  deleteCheckin(@CurrentUser() user: AuthenticatedUser, @Param("date") date: string) {
    return this.metricsService.deleteCheckin(user.userId, date);
  }
}
