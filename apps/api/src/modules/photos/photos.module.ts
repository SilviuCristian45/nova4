import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProgressPhotoEntity } from "../../database/entities";
import { PhotosController } from "./photos.controller";
import { PhotosService } from "./photos.service";

@Module({
  imports: [TypeOrmModule.forFeature([ProgressPhotoEntity])],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
