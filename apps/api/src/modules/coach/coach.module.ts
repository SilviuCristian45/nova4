import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CoachClientNoteEntity,
  CoachProfileEntity,
  DailyCheckinEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  EnrollmentEntity,
  MealEntity,
  ProfileEntity,
  ProgramEntity,
  ProgramWorkoutCardioEntity,
  ProgramWorkoutEntity,
  ProgramWorkoutExerciseEntity,
  WeeklyCheckinEntity,
  WorkoutEntity,
  WorkoutFeedbackEntity,
} from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import {
  CoachController,
  ExploreController,
  FeedbackController,
  WeeklyCheckinsController,
} from "./coach.controller";
import { CoachService } from "./coach.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProgramEntity,
      ProgramWorkoutEntity,
      ProgramWorkoutExerciseEntity,
      ProgramWorkoutCardioEntity,
      EnrollmentEntity,
      CoachClientNoteEntity,
      CoachProfileEntity,
      ProfileEntity,
      CoachClientNoteEntity,
      WorkoutEntity,
      WorkoutFeedbackEntity,
      WeeklyCheckinEntity,
      DailyStepsEntity,
      DailyWeightEntity,
      DailyCheckinEntity,
      MealEntity,
    ]),
    AuthModule,
    NotificationsModule,
  ],
  controllers: [CoachController, ExploreController, FeedbackController, WeeklyCheckinsController],
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
