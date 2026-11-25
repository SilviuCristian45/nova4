import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CoachProfileEntity,
  EnrollmentEntity,
  FoodEntity,
  MealEntity,
  MealItemEntity,
  MealPlanDayEntity,
  MealPlanEntity,
  MealPlanItemEntity,
  MealPlanMealEntity,
  ProfileEntity,
  UserTargetEntity,
} from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import {
  ClientMealPlansController,
  CoachMealPlansController,
  PublicMealPlansController,
} from "./meal-plans.controller";
import { MealPlansService } from "./meal-plans.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MealPlanEntity,
      MealPlanDayEntity,
      MealPlanMealEntity,
      MealPlanItemEntity,
      EnrollmentEntity,
      CoachProfileEntity,
      ProfileEntity,
      FoodEntity,
      MealEntity,
      MealItemEntity,
      UserTargetEntity,
    ]),
    AuthModule,
    NotificationsModule,
  ],
  controllers: [CoachMealPlansController, ClientMealPlansController, PublicMealPlansController],
  providers: [MealPlansService],
  exports: [MealPlansService],
})
export class MealPlansModule {}
