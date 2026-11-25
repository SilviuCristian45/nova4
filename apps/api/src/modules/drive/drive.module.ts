import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GoogleDriveBackupEntity, ProgressPhotoEntity } from "../../database/entities";
import { AccountModule } from "../account/account.module";
import { DRIVE_CLEANUP_HOOK } from "../account/account.service";
import { DriveController } from "./drive.controller";
import { DriveService } from "./drive.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([GoogleDriveBackupEntity, ProgressPhotoEntity]),
    forwardRef(() => AccountModule),
  ],
  controllers: [DriveController],
  providers: [
    DriveService,
    {
      provide: DRIVE_CLEANUP_HOOK,
      useExisting: DriveService,
    },
  ],
  exports: [DriveService, DRIVE_CLEANUP_HOOK],
})
export class DriveModule {}
