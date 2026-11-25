import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "Alex", maxLength: 80, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  displayName?: string | null;

  @ApiPropertyOptional({ example: 180.5, minimum: 50, maximum: 272, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(50)
  @Max(272)
  heightCm?: number | null;

  @ApiPropertyOptional({ example: "1995-06-15", nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "birthDate must be formatted as YYYY-MM-DD" })
  birthDate?: string | null;

  @ApiPropertyOptional({ enum: ["male", "female"], nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(["male", "female"])
  sex?: "male" | "female" | null;

  @ApiPropertyOptional({ enum: ["kg", "lb"] })
  @IsOptional()
  @IsIn(["kg", "lb"])
  weightUnit?: "kg" | "lb";

  @ApiPropertyOptional({ example: 10000, minimum: 1, maximum: 1000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  dailyStepsGoal?: number;

  @ApiPropertyOptional({
    enum: ["sedentary", "light", "moderate", "active", "very_active"],
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(["sedentary", "light", "moderate", "active", "very_active"])
  activityLevel?: "sedentary" | "light" | "moderate" | "active" | "very_active" | null;

  @ApiPropertyOptional({ example: -0.5, minimum: -1, maximum: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1)
  @Max(1)
  goalKgPerWeek?: number;
}

export class UpsertCoachProfileDto {
  @ApiProperty({ example: "Coach Alex", minLength: 1, maxLength: 80 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName: string;

  @ApiPropertyOptional({ example: "Strength & hypertrophy coach", maxLength: 1000, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @ApiPropertyOptional({
    example: ["Hypertrophy", "Strength"],
    description: "Array of specialty tags (max 10) or a comma-separated string",
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === "string") return value.split(",");
    return value;
  })
  @IsArray()
  @IsString({ each: true })
  specialties?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  acceptingClients?: boolean;
}
