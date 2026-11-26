import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { buildDataSourceOptions } from "./database/data-source";
import { AccountModule } from "./modules/account/account.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CoachModule } from "./modules/coach/coach.module";
import { DriveModule } from "./modules/drive/drive.module";
import { FoodsModule } from "./modules/foods/foods.module";
import { GymModule } from "./modules/gym/gym.module";
import { HealthModule } from "./modules/health/health.module";
import { MealPlansModule } from "./modules/meal-plans/meal-plans.module";
import { MealsModule } from "./modules/meals/meals.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { OfflineModule } from "./modules/offline/offline.module";
import { PhotosModule } from "./modules/photos/photos.module";
import { ProfilesModule } from "./modules/profiles/profiles.module";
import { WorkoutsModule } from "./modules/workouts/workouts.module";
import { StorageModule } from "./storage/storage.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get<string>("THROTTLE_TTL_MS") ?? 60_000),
          limit: Number(config.get<string>("THROTTLE_LIMIT") ?? 120),
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildDataSourceOptions(config.get<string>("DATABASE_URL")),
    }),
    StorageModule,
    AuthModule,
    ProfilesModule,
    WorkoutsModule,
    MetricsModule,
    FoodsModule,
    MealsModule,
    PhotosModule,
    OfflineModule,
    NotificationsModule,
    CoachModule,
    MealPlansModule,
    AccountModule,
    AdminModule,
    GymModule,
    DriveModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
