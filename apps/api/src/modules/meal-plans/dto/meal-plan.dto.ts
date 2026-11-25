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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  MEAL_PLAN_GOALS,
  MEAL_PLAN_MEAL_TYPES,
  MEAL_PLAN_STATUSES,
  type MealPlanGoal,
  type MealPlanMealType,
  type MealPlanStatus,
} from "@replog/shared";

export class MealPlanItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  foodId?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.1)
  @Max(10000)
  grams: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(10000)
  kcalPer100g: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(1000)
  proteinPer100g: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(1000)
  carbsPer100g: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(1000)
  fatPer100g: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(1000)
  fiberPer100g?: number | null;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}

export class MealPlanMealDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ enum: MEAL_PLAN_MEAL_TYPES })
  @IsIn(MEAL_PLAN_MEAL_TYPES)
  mealType: MealPlanMealType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  timeLabel?: string;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [MealPlanItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealPlanItemDto)
  items: MealPlanItemDto[];
}

export class MealPlanDayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title: string;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [MealPlanMealDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealPlanMealDto)
  meals: MealPlanMealDto[];
}

export class SaveMealPlanDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  assignedClientId?: string | null;

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

  @ApiProperty({ enum: MEAL_PLAN_GOALS })
  @IsIn(MEAL_PLAN_GOALS)
  goal: MealPlanGoal;

  @ApiProperty({ enum: MEAL_PLAN_STATUSES })
  @IsIn(MEAL_PLAN_STATUSES)
  status: MealPlanStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(500)
  @Max(15000)
  targetKcal?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1000)
  targetProteinG?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(2000)
  targetCarbsG?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(500)
  targetFatG?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(200)
  targetFiberG?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0.5)
  @Max(15)
  waterLiters?: number | null;

  @ApiPropertyOptional({ default: "" })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string;

  @ApiProperty({ type: [MealPlanDayDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealPlanDayDto)
  days: MealPlanDayDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyClient?: boolean;
}

export class CloneMealPlanDto {
  @ApiProperty()
  @IsUUID()
  clientId: string;
}

export class ToggleShareLinkDto {
  @ApiProperty()
  @IsBoolean()
  enable: boolean;
}
