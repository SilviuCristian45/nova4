import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CardioSessionEntity,
  DailyCheckinEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  OfflineSyncReceiptEntity,
  WorkoutEntity,
  WorkoutSetEntity,
} from "../../database/entities";
import { OfflineController } from "./offline.controller";
import { OfflineService } from "./offline.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutEntity,
      WorkoutSetEntity,
      CardioSessionEntity,
      DailyStepsEntity,
      DailyWeightEntity,
      DailyCheckinEntity,
      OfflineSyncReceiptEntity,
    ]),
  ],
  controllers: [OfflineController],
  providers: [OfflineService],
  exports: [OfflineService],
})
export class OfflineModule {}
