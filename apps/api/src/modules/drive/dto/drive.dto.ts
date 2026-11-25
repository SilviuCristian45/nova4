import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MinLength } from "class-validator";
import { AUTO_BACKUP_FREQUENCIES, type AutoBackupFrequency } from "@replog/shared";

export class SetDriveFrequencyDto {
  @ApiProperty({ enum: AUTO_BACKUP_FREQUENCIES })
  @IsIn(AUTO_BACKUP_FREQUENCIES)
  frequency: AutoBackupFrequency;
}

export class DriveFileIdDto {
  @ApiProperty({ description: "Google Drive file ID inside appDataFolder" })
  @IsString()
  @MinLength(1)
  fileId: string;
}
