import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import {
  CardioSessionEntity,
  CoachClientNoteEntity,
  CoachProfileEntity,
  DailyCheckinEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  EnrollmentEntity,
  FoodEntity,
  GoogleDriveBackupEntity,
  GymAuditLogEntity,
  GymCheckinEntity,
  GymEntity,
  GymMemberEntity,
  GymMembershipPlanEntity,
  GymPaymentEntity,
  GymStaffEntity,
  GymSubscriptionEntity,
  MealEntity,
  MealItemEntity,
  MealPlanDayEntity,
  MealPlanEntity,
  MealPlanItemEntity,
  MealPlanMealEntity,
  MealTemplateEntity,
  NotificationEntity,
  OfflineSyncReceiptEntity,
  ProfileEntity,
  ProgramEntity,
  ProgramWorkoutCardioEntity,
  ProgramWorkoutEntity,
  ProgramWorkoutExerciseEntity,
  ProgressPhotoEntity,
  RefreshTokenEntity,
  UserEntity,
  UserTargetEntity,
  WeeklyCheckinEntity,
  WorkoutDraftEntity,
  WorkoutEntity,
  WorkoutFeedbackEntity,
  WorkoutSetEntity,
} from "./entities";
import { InitialSchema1764000000000 } from "./migrations/1764000000000-InitialSchema";
import { AddUserDisabledAt1765000000000 } from "./migrations/1765000000000-AddUserDisabledAt";
import { AddGymManagement1766000000000 } from "./migrations/1766000000000-AddGymManagement";

export const DATABASE_ENTITIES = [
  UserEntity,
  RefreshTokenEntity,
  ProfileEntity,
  CoachProfileEntity,
  EnrollmentEntity,
  WorkoutEntity,
  WorkoutSetEntity,
  CardioSessionEntity,
  WorkoutDraftEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  DailyCheckinEntity,
  FoodEntity,
  MealEntity,
  MealItemEntity,
  MealTemplateEntity,
  UserTargetEntity,
  ProgressPhotoEntity,
  OfflineSyncReceiptEntity,
  NotificationEntity,
  ProgramEntity,
  ProgramWorkoutEntity,
  ProgramWorkoutExerciseEntity,
  ProgramWorkoutCardioEntity,
  CoachClientNoteEntity,
  WorkoutFeedbackEntity,
  WeeklyCheckinEntity,
  MealPlanEntity,
  MealPlanDayEntity,
  MealPlanMealEntity,
  MealPlanItemEntity,
  GoogleDriveBackupEntity,
  GymEntity,
  GymStaffEntity,
  GymMembershipPlanEntity,
  GymMemberEntity,
  GymSubscriptionEntity,
  GymPaymentEntity,
  GymCheckinEntity,
  GymAuditLogEntity,
];

export const DATABASE_MIGRATIONS = [
  InitialSchema1764000000000,
  AddUserDisabledAt1765000000000,
  AddGymManagement1766000000000,
];

export function buildDataSourceOptions(databaseUrl?: string): DataSourceOptions {
  const url =
    databaseUrl ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/replog";

  return {
    type: "postgres",
    url,
    entities: DATABASE_ENTITIES,
    migrations: DATABASE_MIGRATIONS,
    migrationsRun: process.env.TYPEORM_MIGRATIONS_RUN !== "false",
    synchronize: false,
    logging: process.env.TYPEORM_LOGGING === "true",
  };
}

export const AppDataSource = new DataSource(buildDataSourceOptions());
