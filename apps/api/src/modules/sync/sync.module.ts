import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SyncChangeEntity } from "../../database/entities";
import { StorageModule } from "../../storage/storage.module";
import { FoodsModule } from "../foods/foods.module";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

@Module({
  imports: [TypeOrmModule.forFeature([SyncChangeEntity]), FoodsModule, StorageModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
