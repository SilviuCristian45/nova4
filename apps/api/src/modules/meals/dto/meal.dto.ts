import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { CreateCustomFoodDto } from "../../foods/dto/food.dto";

export class MealItemInputDto {
  @ApiPropertyOptional({ description: "Existing food UUID (shared or own custom)" })
  @IsOptional()
  @IsUUID()
  foodId?: string;

  @ApiPropertyOptional({ description: "Barcode resolved server-side via shared catalog" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  barcode?: string;

  @ApiPropertyOptional({ description: "Inline custom food to create privately when foodId is omitted" })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomFoodDto)
  customFood?: CreateCustomFoodDto;

  @ApiProperty({ example: 150, minimum: 0.1, maximum: 20000 })
  @IsNumber()
  @Min(0.1)
  @Max(20000)
  grams: number;
}

export class CreateMealDto {
  @ApiProperty({ enum: ["Breakfast", "Lunch", "Dinner", "Snack"] })
  @IsIn(["Breakfast", "Lunch", "Dinner", "Snack"])
  mealType: "Breakfast" | "Lunch" | "Dinner" | "Snack";

  @ApiPropertyOptional({ example: "2026-11-25" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "performedOn must be YYYY-MM-DD" })
  performedOn?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ type: [MealItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MealItemInputDto)
  items: MealItemInputDto[];
}

export class CreateMealTemplateDto {
  @ApiProperty({ example: "High Protein Breakfast", maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMaxSize(100)
  items: unknown[];
}

export class UpsertUserTargetsDto {
  @ApiProperty({ example: 2200, minimum: 500, maximum: 15000 })
  @IsInt()
  @Min(500)
  @Max(15000)
  kcal: number;

  @ApiProperty({ example: 160, minimum: 0, maximum: 1000 })
  @IsInt()
  @Min(0)
  @Max(1000)
  protein: number;

  @ApiProperty({ example: 250, minimum: 0, maximum: 2000 })
  @IsInt()
  @Min(0)
  @Max(2000)
  carbs: number;

  @ApiProperty({ example: 70, minimum: 0, maximum: 500 })
  @IsInt()
  @Min(0)
  @Max(500)
  fat: number;

  @ApiProperty({ example: 30, minimum: 0, maximum: 200 })
  @IsInt()
  @Min(0)
  @Max(200)
  fiber: number;
}
