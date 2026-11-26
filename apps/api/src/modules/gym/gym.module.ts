import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GymStaffGuard } from "../../common/guards/gym-staff.guard";
import { SuperAdminGuard } from "../../common/guards/super-admin.guard";
import {
  GymAuditLogEntity,
  GymCheckinEntity,
  GymEntity,
  GymMemberEntity,
  GymMembershipPlanEntity,
  GymPaymentEntity,
  GymStaffEntity,
  GymSubscriptionEntity,
  ProfileEntity,
  UserEntity,
} from "../../database/entities";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminGymsController } from "./admin-gyms.controller";
import { GymController } from "./gym.controller";
import { GymSseService } from "./gym-sse.service";
import { GymService } from "./gym.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GymEntity,
      GymStaffEntity,
      GymMembershipPlanEntity,
      GymMemberEntity,
      GymSubscriptionEntity,
      GymPaymentEntity,
      GymCheckinEntity,
      GymAuditLogEntity,
      UserEntity,
      ProfileEntity,
    ]),
    AuthModule,
    NotificationsModule,
  ],
  controllers: [AdminGymsController, GymController],
  providers: [GymService, GymSseService, GymStaffGuard, SuperAdminGuard],
  exports: [GymService, GymSseService],
})
export class GymModule {}
