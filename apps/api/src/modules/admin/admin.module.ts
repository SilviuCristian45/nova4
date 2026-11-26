import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SuperAdminGuard } from "../../common/guards/super-admin.guard";
import {
  CoachProfileEntity,
  ProfileEntity,
  RefreshTokenEntity,
  UserEntity,
} from "../../database/entities";
import { AccountModule } from "../account/account.module";
import { AuthModule } from "../auth/auth.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, ProfileEntity, CoachProfileEntity, RefreshTokenEntity]),
    AuthModule,
    AccountModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, SuperAdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
