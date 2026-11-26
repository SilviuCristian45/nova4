import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import type { UserRole, WeightUnit } from "@replog/shared";

export class AdminCreateUserDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 128, example: "StrongPass123!" })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  displayName?: string | null;

  @ApiPropertyOptional({ enum: ["client", "coach"], default: "client" })
  @IsOptional()
  @IsIn(["client", "coach"])
  role?: UserRole;

  @ApiPropertyOptional({ enum: ["kg", "lb"], default: "kg" })
  @IsOptional()
  @IsIn(["kg", "lb"])
  weightUnit?: WeightUnit;

  @ApiPropertyOptional({ minimum: 1, maximum: 200000, default: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200000)
  dailyStepsGoal?: number;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ example: "updated@example.com" })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  displayName?: string | null;

  @ApiPropertyOptional({ enum: ["client", "coach"] })
  @IsOptional()
  @IsIn(["client", "coach"])
  role?: UserRole;

  @ApiPropertyOptional({ enum: ["kg", "lb"] })
  @IsOptional()
  @IsIn(["kg", "lb"])
  weightUnit?: WeightUnit;

  @ApiPropertyOptional({ minimum: 1, maximum: 200000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200000)
  dailyStepsGoal?: number;
}

export class AdminSetUserStatusDto {
  @ApiProperty({ description: "true to disable account immediately, false to re-enable" })
  @IsBoolean()
  disabled: boolean;
}

export class AdminResetPasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 128, example: "NewStrongPass123!" })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
