import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  GYM_MEMBER_STATUSES,
  GYM_PAYMENT_METHODS,
  GYM_PLAN_TYPES,
  GYM_STAFF_ROLES,
  type GymMemberStatus,
  type GymPaymentMethod,
  type GymPlanType,
  type GymStaffRole,
} from "@replog/shared";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class AdminCreateGymDto {
  @ApiProperty({ example: "Titan Fitness Studio" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: "titan-fitness-studio" })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @ApiPropertyOptional({ default: "Europe/Bucharest" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ default: "RON" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number | null;

  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkinCooldownMinutes?: number;

  @ApiPropertyOptional({ description: "User ID to assign as gym owner" })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({ description: "Alternative: user email to assign as gym owner" })
  @IsOptional()
  @IsEmail()
  ownerEmail?: string;
}

export class AdminUpdateGymDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkinCooldownMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}

export class ScanCheckinDto {
  @ApiProperty({ description: "Raw QR token or full scan URL containing ?code=..." })
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  qrToken: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class ManualCheckinDto {
  @ApiPropertyOptional({ description: "Gym member ID" })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({ description: "User ID of the member" })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ example: "Phone battery dead at reception" })
  @IsString()
  @MinLength(2)
  @MaxLength(280)
  overrideReason: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  deductSession?: boolean;
}

export class UpdateGymSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkinCooldownMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(50000)
  checkinRadiusMeters?: number | null;
}

export class UpsertGymStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: GYM_STAFF_ROLES })
  @IsIn(GYM_STAFF_ROLES)
  role: GymStaffRole;
}

export class CreatePlanDto {
  @ApiProperty({ example: "Full Access 30 Days" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ enum: GYM_PLAN_TYPES })
  @IsIn(GYM_PLAN_TYPES)
  planType: GymPlanType;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  sessionCount?: number | null;

  @ApiProperty({ example: 25000, description: "Price in minor units (e.g. bani/cents)" })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents: number;

  @ApiPropertyOptional({ default: "RON" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ example: "07:00" })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  allowedFromTime?: string | null;

  @ApiPropertyOptional({ example: "16:00" })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  allowedToTime?: string | null;

  @ApiPropertyOptional({ default: 127 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(127)
  allowedDaysMask?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  maxFreezeDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  position?: number;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ enum: GYM_PLAN_TYPES })
  @IsOptional()
  @IsIn(GYM_PLAN_TYPES)
  planType?: GymPlanType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  sessionCount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  allowedFromTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  allowedToTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(127)
  allowedDaysMask?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  maxFreezeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  position?: number;
}

export class CreateMemberDto {
  @ApiProperty({ example: "member@example.com" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: "Andrei Popescu" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ description: "Optional password if creating a brand-new RepLog account" })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  emergencyContact?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ example: "MEM-0042" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  memberCode?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  emergencyContact?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ enum: GYM_MEMBER_STATUSES })
  @IsOptional()
  @IsIn(GYM_MEMBER_STATUSES)
  status?: GymMemberStatus;
}

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty()
  @IsUUID()
  planId: string;

  @ApiPropertyOptional({ description: "ISO timestamp for start; defaults to now" })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  recordPayment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  paymentAmountCents?: number;

  @ApiPropertyOptional({ enum: GYM_PAYMENT_METHODS, default: "cash" })
  @IsOptional()
  @IsIn(GYM_PAYMENT_METHODS)
  paymentMethod?: GymPaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentNote?: string | null;
}

export class FreezeSubscriptionDto {
  @ApiPropertyOptional({ description: "ISO date/timestamp until subscription remains frozen" })
  @IsOptional()
  @IsISO8601()
  frozenUntil?: string;

  @ApiPropertyOptional({ description: "Alternative: number of days to freeze" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}
