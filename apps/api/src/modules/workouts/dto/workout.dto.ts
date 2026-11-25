import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class WorkoutSetInputDto {
  @ApiPropertyOptional({ description: "Existing set UUID when editing a workout" })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: "Push", maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  split: string;

  @ApiProperty({ example: "Bench Press (Barbell)", maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  exercise: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  setNumber: number;

  @ApiProperty({ example: 8, minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100000)
  reps: number;

  @ApiProperty({ example: 80, minimum: 0, maximum: 10000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  weight: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 5, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(5)
  rir?: number | null;

  @ApiProperty({ example: "Working Set", maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  setType: string;

  @ApiPropertyOptional({ example: "Paused rep", maxLength: 99, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(99)
  notes?: string | null;
}

export class CardioSessionInputDto {
  @ApiProperty({ example: "Treadmill - LISS", maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  activity: string;

  @ApiProperty({ example: 30, minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMin: number;
}

export class CreateWorkoutDto {
  @ApiProperty({ enum: ["strength", "cardio"] })
  @IsIn(["strength", "cardio"])
  mode: "strength" | "cardio";

  @ApiProperty({ example: "Push", maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  split: string;

  @ApiProperty({ example: "2026-11-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date: string;

  @ApiProperty({ type: [WorkoutSetInputDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetInputDto)
  sets: WorkoutSetInputDto[];

  @ApiProperty({ type: [CardioSessionInputDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CardioSessionInputDto)
  cardio: CardioSessionInputDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  programWorkoutId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  enrollmentId?: string | null;
}

export class UpdateWorkoutDto {
  @ApiProperty({ enum: ["strength", "cardio"] })
  @IsIn(["strength", "cardio"])
  mode: "strength" | "cardio";

  @ApiProperty({ example: "Push", maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  split: string;

  @ApiProperty({ example: "2026-11-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date: string;

  @ApiProperty({ type: [WorkoutSetInputDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetInputDto)
  sets: WorkoutSetInputDto[];

  @ApiProperty({ type: [CardioSessionInputDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CardioSessionInputDto)
  cardio: CardioSessionInputDto[];
}

export class SaveWorkoutDraftDto {
  @ApiProperty({ type: Object })
  @IsObject()
  draft: Record<string, unknown>;

  @ApiProperty({ example: "2026-11-25T18:00:00.000Z" })
  @IsDateString()
  clientUpdatedAt: string;
}
