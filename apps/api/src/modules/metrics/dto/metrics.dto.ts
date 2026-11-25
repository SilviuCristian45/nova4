import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class UpsertStepsDto {
  @ApiProperty({ example: "2026-11-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date: string;

  @ApiProperty({ example: 8500, minimum: 0, maximum: 2147483647 })
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  steps: number;
}

export class UpsertWeightDto {
  @ApiProperty({ example: "2026-11-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date: string;

  @ApiProperty({ example: 78.45, minimum: 0.01, maximum: 9999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999.99)
  weightKg: number;
}

export class UpsertDailyCheckinDto {
  @ApiProperty({ example: "2026-11-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10)
  energy?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10)
  satiety?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10)
  sleep?: number | null;

  @ApiPropertyOptional({ maxLength: 280, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(280)
  note?: string | null;
}
