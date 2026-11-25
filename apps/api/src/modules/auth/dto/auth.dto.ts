import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: "StrongPass123!", minLength: 6, maxLength: 128 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ enum: ["client", "coach"], default: "client" })
  @IsOptional()
  @IsIn(["client", "coach"])
  role?: "client" | "coach";

  @ApiPropertyOptional({ example: "Alex", maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: "StrongPass123!" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: "Optional when refresh cookie is sent automatically" })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: "Optional when refresh cookie is sent automatically" })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "OldPassword123!" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ example: "NewStrongPass123!", minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class ChangeEmailDto {
  @ApiProperty({ example: "new-email@example.com" })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: "CurrentPassword123!" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;
}

export class ActivateCoachDto {
  @ApiPropertyOptional({ example: "Coach Alex", maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}
