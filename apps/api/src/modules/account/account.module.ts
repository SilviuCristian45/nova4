import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GoogleDriveBackupEntity, UserEntity } from "../../database/entities";
import { DriveModule } from "../drive/drive.module";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, GoogleDriveBackupEntity]),
    forwardRef(() => DriveModule),
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
