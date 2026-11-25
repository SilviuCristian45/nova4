import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DailyCheckinEntity, DailyStepsEntity, DailyWeightEntity } from "../../database/entities";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [TypeOrmModule.forFeature([DailyStepsEntity, DailyWeightEntity, DailyCheckinEntity])],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
