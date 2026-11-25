import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FoodEntity } from "../../database/entities";
import { FoodsController } from "./foods.controller";
import { FoodsService } from "./foods.service";

@Module({
  imports: [TypeOrmModule.forFeature([FoodEntity])],
  controllers: [FoodsController],
  providers: [FoodsService],
  exports: [FoodsService],
})
export class FoodsModule {}
