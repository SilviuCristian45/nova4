import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CardioSessionEntity,
  DailyWeightEntity,
  EnrollmentEntity,
  NotificationEntity,
  ProfileEntity,
  WorkoutDraftEntity,
  WorkoutEntity,
  WorkoutSetEntity,
} from "../../database/entities";
import { WorkoutsController } from "./workouts.controller";
import { WorkoutsService } from "./workouts.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutEntity,
      WorkoutSetEntity,
      CardioSessionEntity,
      WorkoutDraftEntity,
      DailyWeightEntity,
      EnrollmentEntity,
      NotificationEntity,
      ProfileEntity,
    ]),
  ],
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
