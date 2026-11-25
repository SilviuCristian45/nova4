import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  DailyWeightEntity,
  FoodEntity,
  MealEntity,
  MealItemEntity,
  MealTemplateEntity,
  ProfileEntity,
  UserTargetEntity,
} from "../../database/entities";
import { FoodsModule } from "../foods/foods.module";
import { MealsController } from "./meals.controller";
import { MealsService } from "./meals.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MealEntity,
      MealItemEntity,
      MealTemplateEntity,
      UserTargetEntity,
      FoodEntity,
      ProfileEntity,
      DailyWeightEntity,
    ]),
    FoodsModule,
  ],
  controllers: [MealsController],
  providers: [MealsService],
  exports: [MealsService],
})
export class MealsModule {}
