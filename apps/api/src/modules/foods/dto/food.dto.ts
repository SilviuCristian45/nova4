import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";

export class CreateCustomFoodDto {
  @ApiProperty({ example: "Homemade Oats", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: "Home", maxLength: 120, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120)
  brand?: string | null;

  @ApiProperty({ example: 370, minimum: 0, maximum: 10000 })
  @IsNumber()
  @Min(0)
  @Max(10000)
  kcalPer100g: number;

  @ApiProperty({ example: 13.5, minimum: 0, maximum: 1000 })
  @IsNumber()
  @Min(0)
  @Max(1000)
  proteinPer100g: number;

  @ApiProperty({ example: 60, minimum: 0, maximum: 1000 })
  @IsNumber()
  @Min(0)
  @Max(1000)
  carbsPer100g: number;

  @ApiProperty({ example: 7, minimum: 0, maximum: 1000 })
  @IsNumber()
  @Min(0)
  @Max(1000)
  fatPer100g: number;

  @ApiPropertyOptional({ example: 1.2, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  saturatedFatPer100g?: number;

  @ApiPropertyOptional({ example: 2.5, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  polyunsaturatedFatPer100g?: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  fiberPer100g?: number;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  sodiumMgPer100g?: number;
}
