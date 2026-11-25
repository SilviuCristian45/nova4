import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { PHOTO_MAX_BYTES, PHOTO_NOTE_MAX, PHOTO_POSES, type PhotoPose } from "@replog/shared";

export class RequestPhotoUploadDto {
  @ApiProperty({ example: 350000, minimum: 1, maximum: PHOTO_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes: number;
}

export class CreatePhotoDto {
  @ApiProperty({ description: "UUID returned by POST /api/v1/photos/upload-url" })
  @IsUUID()
  id: string;

  @ApiProperty({ example: "2026-11-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "takenOn must be YYYY-MM-DD" })
  takenOn: string;

  @ApiProperty({ enum: PHOTO_POSES, default: "front" })
  @IsIn(PHOTO_POSES)
  pose: PhotoPose;

  @ApiPropertyOptional({ maxLength: PHOTO_NOTE_MAX, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(PHOTO_NOTE_MAX)
  note?: string | null;

  @ApiProperty({ example: 350000, minimum: 1, maximum: PHOTO_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes: number;
}
