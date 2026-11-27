import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import type { SyncEntityType, SyncOperation } from "../../../database/entities/sync-change.entity";

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  "profile",
  "user_targets",
  "food",
  "workout",
  "meal",
  "meal_template",
  "daily_steps",
  "daily_weight",
  "daily_checkin",
  "progress_photo",
] as const;

export const SYNC_OPERATIONS: readonly SyncOperation[] = ["upsert", "delete"] as const;

export class SyncMutationDto {
  @ApiProperty({ description: "Client-generated UUIDv4 idempotency key" })
  @IsUUID()
  mutationId: string;

  @ApiProperty({ enum: SYNC_ENTITY_TYPES })
  @IsIn(SYNC_ENTITY_TYPES)
  entityType: SyncEntityType;

  @ApiProperty({ description: "Entity UUID, YYYY-MM-DD for daily metrics, or 'self' for profile/targets" })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  entityId: string;

  @ApiProperty({ enum: SYNC_OPERATIONS })
  @IsIn(SYNC_OPERATIONS)
  op: SyncOperation;

  @ApiProperty({ example: "2026-11-27T09:00:00.000Z" })
  @IsDateString()
  clientUpdatedAt: string;

  @ApiPropertyOptional({ type: Object, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsObject()
  payload?: Record<string, unknown> | null;
}

export class SyncPushDto {
  @ApiProperty({ type: [SyncMutationDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SyncMutationDto)
  mutations: SyncMutationDto[];
}
