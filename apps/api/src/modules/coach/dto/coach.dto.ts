import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
import {
  FEEDBACK_REACTIONS,
  PHOTO_MAX_BYTES,
  PROGRAM_ACCESS_TYPES,
  PROGRAM_DIFFICULTIES,
  PROGRAM_GOALS,
  PROGRAM_STATUSES,
  type FeedbackReaction,
  type ProgramAccessType,
  type ProgramDifficulty,
  type ProgramGoal,
  type ProgramStatus,
} from "@replog/shared";

export class ProgramExerciseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  exercise: string;

  @ApiProperty({ default: "Working Set" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  setType: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(50)
  targetSets: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1000)
  targetRepsMin: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1000)
  targetRepsMax: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(5)
  targetRir?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(10000)
  targetWeightKg?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(10)
  @Max(900)
  restSeconds?: number | null;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}

export class ProgramCardioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  activity: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1440)
  targetDurationMin: number;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}

export class ProgramWorkoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(52)
  weekNumber: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(7)
  dayNumber: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiProperty({ enum: ["strength", "cardio"] })
  @IsIn(["strength", "cardio"])
  workoutMode: "strength" | "cardio";

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  split: string;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [ProgramExerciseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramExerciseDto)
  exercises: ProgramExerciseDto[];

  @ApiProperty({ type: [ProgramCardioDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramCardioDto)
  cardio: ProgramCardioDto[];
}

export class SaveProgramDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: PROGRAM_DIFFICULTIES })
  @IsIn(PROGRAM_DIFFICULTIES)
  difficulty: ProgramDifficulty;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(52)
  durationWeeks: number;

  @ApiProperty({ enum: PROGRAM_GOALS })
  @IsIn(PROGRAM_GOALS)
  goal: ProgramGoal;

  @ApiProperty({ enum: PROGRAM_STATUSES })
  @IsIn(PROGRAM_STATUSES)
  status: ProgramStatus;

  @ApiProperty({ enum: PROGRAM_ACCESS_TYPES })
  @IsIn(PROGRAM_ACCESS_TYPES)
  accessType: ProgramAccessType;

  @ApiProperty()
  @IsBoolean()
  requiresApproval: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(32)
  inviteCode?: string | null;

  @ApiProperty({ type: [ProgramWorkoutDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramWorkoutDto)
  workouts: ProgramWorkoutDto[];
}

export class CloneProgramForClientDto {
  @ApiProperty()
  @IsUUID()
  clientId: string;
}

export class RespondEnrollmentDto {
  @ApiProperty({ enum: ["active", "rejected"] })
  @IsIn(["active", "rejected"])
  decision: "active" | "rejected";
}

export class UpdateEnrollmentStatusDto {
  @ApiProperty({ enum: ["active", "paused", "completed"] })
  @IsIn(["active", "paused", "completed"])
  status: "active" | "paused" | "completed";
}

export class ClientEnrollmentStatusDto {
  @ApiProperty({ enum: ["paused", "completed"] })
  @IsIn(["paused", "completed"])
  status: "paused" | "completed";
}

export class UpdateEnrollmentWeekDto {
  @ApiProperty({ minimum: 1, maximum: 52 })
  @IsInt()
  @Min(1)
  @Max(52)
  currentWeek: number;
}

export class AssignProgramDto {
  @ApiProperty()
  @IsUUID()
  programId: string;
}

export class SaveCoachNoteDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  note: string;
}

export class EnrollInProgramDto {
  @ApiProperty()
  @IsUUID()
  programId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(32)
  inviteCode?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  shareNutrition?: boolean;
}

export class ToggleNutritionShareDto {
  @ApiProperty()
  @IsBoolean()
  shareNutrition: boolean;
}

export class AddWorkoutFeedbackDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body: string;

  @ApiPropertyOptional({ enum: FEEDBACK_REACTIONS, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(FEEDBACK_REACTIONS)
  reaction?: FeedbackReaction | null;
}

export class RequestCheckinPhotoUploadDto {
  @ApiProperty({ minimum: 1, maximum: PHOTO_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes: number;
}

export class SubmitWeeklyCheckinDto {
  @ApiProperty()
  @IsUUID()
  coachId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  enrollmentId?: string | null;

  @ApiPropertyOptional({ example: "2026-11-23" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "weekStart must be YYYY-MM-DD" })
  weekStart?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0.01)
  @Max(9999.99)
  weightKg?: number | null;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  energy: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  sleep: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stress: number;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  clientNotes?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  photoFrontPath?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  photoBackPath?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  photoSidePath?: string | null;
}

export class ReviewWeeklyCheckinDto {
  @ApiProperty({ minLength: 1, maxLength: 1500 })
  @IsString()
  @MinLength(1)
  @MaxLength(1500)
  reply: string;
}
