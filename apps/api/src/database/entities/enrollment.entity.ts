import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { EnrollmentStatus } from "@replog/shared";

@Entity({ name: "enrollments" })
export class EnrollmentEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "client_id", type: "uuid" })
  clientId: string;

  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @Column({ name: "program_id", type: "uuid", nullable: true })
  programId: string | null;

  @Column({ type: "text", default: "pending" })
  status: EnrollmentStatus;

  @Column({ name: "share_nutrition", type: "boolean", default: true })
  shareNutrition: boolean;

  @Column({ name: "current_week", type: "integer", default: 1 })
  currentWeek: number;

  @Column({ name: "assigned_by_coach", type: "boolean", default: false })
  assignedByCoach: boolean;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
