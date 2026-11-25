import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString, IsUUID } from "class-validator";

export class OfflineSyncDto {
  @ApiProperty({ description: "Client-generated UUIDv4 idempotency key" })
  @IsUUID("4")
  id: string;

  @ApiProperty({ description: "Owner user UUID from the offline queue" })
  @IsUUID()
  ownerId: string;

  @ApiProperty({ example: "2026-11-25T10:00:00.000Z" })
  @IsString()
  createdAt: string;

  @ApiProperty({ type: Object, description: "OfflinePayload (steps | weight | checkin | workout)" })
  @IsObject()
  payload: Record<string, unknown>;
}
