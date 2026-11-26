import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  GymCheckinMethod,
  GymCheckinOutcome,
  GymMemberStatus,
  GymPaymentMethod,
  GymPlanType,
  GymStaffRole,
  GymSubscriptionStatus,
} from "@replog/shared";

@Entity({ name: "gyms" })
export class GymEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "text", unique: true })
  slug: string;

  @Column({ type: "text" })
  name: string;

  @Column({ type: "text", nullable: true })
  address: string | null;

  @Column({ type: "text", default: "Europe/Bucharest" })
  timezone: string;

  @Column({ name: "qr_token", type: "text", unique: true })
  qrToken: string;

  @Column({ name: "qr_rotated_at", type: "timestamptz", default: () => "now()" })
  qrRotatedAt: Date;

  @Column({ name: "checkin_cooldown_minutes", type: "integer", default: 15 })
  checkinCooldownMinutes: number;

  @Column({ type: "numeric", precision: 9, scale: 6, nullable: true })
  latitude: string | null;

  @Column({ type: "numeric", precision: 9, scale: 6, nullable: true })
  longitude: string | null;

  @Column({ name: "checkin_radius_meters", type: "integer", nullable: true })
  checkinRadiusMeters: number | null;

  @Column({ type: "integer", nullable: true })
  capacity: number | null;

  @Column({ type: "text", default: "RON" })
  currency: string;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

@Entity({ name: "gym_staff" })
export class GymStaffEntity {
  @PrimaryColumn({ name: "gym_id", type: "uuid" })
  gymId: string;

  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "text" })
  role: GymStaffRole;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}

@Entity({ name: "gym_membership_plans" })
export class GymMembershipPlanEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "gym_id", type: "uuid" })
  gymId: string;

  @Column({ type: "text" })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "plan_type", type: "text" })
  planType: GymPlanType;

  @Column({ name: "duration_days", type: "integer" })
  durationDays: number;

  @Column({ name: "session_count", type: "integer", nullable: true })
  sessionCount: number | null;

  @Column({ name: "price_cents", type: "integer" })
  priceCents: number;

  @Column({ type: "text", default: "RON" })
  currency: string;

  @Column({ name: "allowed_from_time", type: "time", nullable: true })
  allowedFromTime: string | null;

  @Column({ name: "allowed_to_time", type: "time", nullable: true })
  allowedToTime: string | null;

  @Column({ name: "allowed_days_mask", type: "smallint", default: 127 })
  allowedDaysMask: number;

  @Column({ name: "max_freeze_days", type: "integer", default: 0 })
  maxFreezeDays: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ type: "integer", default: 1 })
  position: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

@Entity({ name: "gym_members" })
export class GymMemberEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "gym_id", type: "uuid" })
  gymId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "member_code", type: "text" })
  memberCode: string;

  @Column({ type: "text", nullable: true })
  phone: string | null;

  @Column({ name: "emergency_contact", type: "text", nullable: true })
  emergencyContact: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ type: "text", default: "active" })
  status: GymMemberStatus;

  @CreateDateColumn({ name: "joined_at", type: "timestamptz" })
  joinedAt: Date;
}

@Entity({ name: "gym_subscriptions" })
export class GymSubscriptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "gym_id", type: "uuid" })
  gymId: string;

  @Column({ name: "member_id", type: "uuid" })
  memberId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "plan_id", type: "uuid", nullable: true })
  planId: string | null;

  @Column({ name: "plan_name_snapshot", type: "text" })
  planNameSnapshot: string;

  @Column({ name: "plan_type", type: "text" })
  planType: GymPlanType;

  @Column({ type: "text" })
  status: GymSubscriptionStatus;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt: Date;

  @Column({ name: "ends_at", type: "timestamptz" })
  endsAt: Date;

  @Column({ name: "sessions_total", type: "integer", nullable: true })
  sessionsTotal: number | null;

  @Column({ name: "sessions_remaining", type: "integer", nullable: true })
  sessionsRemaining: number | null;

  @Column({ name: "allowed_from_time", type: "time", nullable: true })
  allowedFromTime: string | null;

  @Column({ name: "allowed_to_time", type: "time", nullable: true })
  allowedToTime: string | null;

  @Column({ name: "allowed_days_mask", type: "smallint", default: 127 })
  allowedDaysMask: number;

  @Column({ name: "max_freeze_days", type: "integer", default: 0 })
  maxFreezeDays: number;

  @Column({ name: "frozen_at", type: "timestamptz", nullable: true })
  frozenAt: Date | null;

  @Column({ name: "frozen_until", type: "timestamptz", nullable: true })
  frozenUntil: Date | null;

  @Column({ name: "total_frozen_days", type: "integer", default: 0 })
  totalFrozenDays: number;

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

@Entity({ name: "gym_payments" })
export class GymPaymentEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "gym_id", type: "uuid" })
  gymId: string;

  @Column({ name: "subscription_id", type: "uuid", nullable: true })
  subscriptionId: string | null;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  @Column({ name: "amount_cents", type: "integer" })
  amountCents: number;

  @Column({ type: "text", default: "RON" })
  currency: string;

  @Column({ type: "text" })
  method: GymPaymentMethod;

  @Column({ type: "text", nullable: true })
  reference: string | null;

  @Column({ type: "text", nullable: true })
  note: string | null;

  @Column({ name: "recorded_by_user_id", type: "uuid", nullable: true })
  recordedByUserId: string | null;

  @Column({ name: "paid_at", type: "timestamptz", default: () => "now()" })
  paidAt: Date;
}

@Entity({ name: "gym_checkins" })
export class GymCheckinEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "gym_id", type: "uuid" })
  gymId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "subscription_id", type: "uuid", nullable: true })
  subscriptionId: string | null;

  @Column({ name: "checked_in_at", type: "timestamptz", default: () => "now()" })
  checkedInAt: Date;

  @Column({ name: "checked_out_at", type: "timestamptz", nullable: true })
  checkedOutAt: Date | null;

  @Column({ type: "text" })
  method: GymCheckinMethod;

  @Column({ type: "text" })
  outcome: GymCheckinOutcome;

  @Column({ name: "sessions_after", type: "integer", nullable: true })
  sessionsAfter: number | null;

  @Column({ name: "override_reason", type: "text", nullable: true })
  overrideReason: string | null;

  @Column({ name: "verified_by_user_id", type: "uuid", nullable: true })
  verifiedByUserId: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;
}

@Entity({ name: "gym_audit_logs" })
export class GymAuditLogEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "gym_id", type: "uuid" })
  gymId: string;

  @Column({ name: "actor_user_id", type: "uuid", nullable: true })
  actorUserId: string | null;

  @Column({ type: "text" })
  action: string;

  @Column({ name: "target_type", type: "text", nullable: true })
  targetType: string | null;

  @Column({ name: "target_id", type: "uuid", nullable: true })
  targetId: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  details: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
