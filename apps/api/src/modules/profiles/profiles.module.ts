import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachProfileEntity, ProfileEntity } from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ProfilesController } from "./profiles.controller";
import { ProfilesService } from "./profiles.service";

@Module({
  imports: [TypeOrmModule.forFeature([ProfileEntity, CoachProfileEntity]), AuthModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
