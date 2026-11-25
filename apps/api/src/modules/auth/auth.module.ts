import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CoachProfileEntity,
  EnrollmentEntity,
  ProfileEntity,
  RefreshTokenEntity,
  UserEntity,
} from "../../database/entities";
import { ActiveCoachAccessGuard } from "../../common/guards/active-coach-access.guard";
import { CoachGuard } from "../../common/guards/coach.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RefreshTokenEntity,
      ProfileEntity,
      CoachProfileEntity,
      EnrollmentEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, CoachGuard, ActiveCoachAccessGuard],
  exports: [AuthService, PasswordService, JwtModule, CoachGuard, ActiveCoachAccessGuard],
})
export class AuthModule {}
