import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsObject } from "class-validator";

export class ConfirmEmailDto {
  @ApiProperty({ example: "user@example.com", description: "Must match the signed-in account's email" })
  @IsEmail()
  confirmEmail: string;
}

export class ImportAccountDataDto {
  @ApiProperty({ type: Object, description: "JSON object produced by GET /api/v1/account/export (replog-export v1)" })
  @IsObject()
  data: Record<string, unknown>;
}
