import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "weekly_checkins" })
export class WeeklyCheckinEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "client_id", type: "uuid" })
  clientId: string;

  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @Column({ name: "enrollment_id", type: "uuid", nullable: true })
  enrollmentId: string | null;

  @Column({ name: "week_start", type: "date" })
  weekStart: string;

  @Column({ name: "weight_kg", type: "numeric", precision: 6, scale: 2, nullable: true })
  weightKg: string | null;

  @Column({ type: "smallint" })
  energy: number;

  @Column({ type: "smallint" })
  sleep: number;

  @Column({ type: "smallint" })
  stress: number;

  @Column({ name: "client_notes", type: "text", nullable: true })
  clientNotes: string | null;

  @Column({ name: "coach_reply", type: "text", nullable: true })
  coachReply: string | null;

  @Column({ name: "photo_front_path", type: "text", nullable: true })
  photoFrontPath: string | null;

  @Column({ name: "photo_back_path", type: "text", nullable: true })
  photoBackPath: string | null;

  @Column({ name: "photo_side_path", type: "text", nullable: true })
  photoSidePath: string | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
