import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateCustomFoodDto } from "./dto/food.dto";
import { FoodsService } from "./foods.service";

@ApiTags("Foods")
@ApiBearerAuth()
@Controller("foods")
export class FoodsController {
  constructor(private readonly foodsService: FoodsService) {}

  @Get()
  @ApiOperation({ summary: "List custom foods created by the current user" })
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.foodsService.listUserFoods(user.userId);
  }

  @Get("search")
  @ApiOperation({ summary: "Search local DB + Open Food Facts + optional USDA catalog" })
  @ApiQuery({ name: "q", required: true })
  @ApiQuery({ name: "localOnly", required: false, type: Boolean })
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query("q") q = "",
    @Query("localOnly") localOnly?: string,
  ) {
    return this.foodsService.search(user.userId, q, localOnly !== "true");
  }

  @Get("barcode/:code")
  @ApiOperation({ summary: "Look up or cache a barcode food in the shared catalog (Open Food Facts)" })
  getByBarcode(@Param("code") code: string) {
    return this.foodsService.getByBarcode(code);
  }

  @Post()
  @ApiOperation({ summary: "Create a private custom food for the current user" })
  createCustom(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomFoodDto) {
    return this.foodsService.createCustomFood(user.userId, dto);
  }
}
