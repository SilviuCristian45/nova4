import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { ProgramAccessType, ProgramDifficulty, ProgramGoal, ProgramStatus } from "@replog/shared";
import { ProgramWorkoutEntity } from "./program-workout.entity";

@Entity({ name: "programs" })
export class ProgramEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @Column({ name: "assigned_client_id", type: "uuid", nullable: true })
  assignedClientId: string | null;

  @Column({ type: "text" })
  title: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "text", default: "intermediate" })
  difficulty: ProgramDifficulty;

  @Column({ name: "duration_weeks", type: "integer", default: 4 })
  durationWeeks: number;

  @Column({ type: "text", default: "hypertrophy" })
  goal: ProgramGoal;

  @Column({ type: "text", default: "draft" })
  status: ProgramStatus;

  @Column({ name: "access_type", type: "text", default: "public" })
  accessType: ProgramAccessType;

  @Column({ name: "requires_approval", type: "boolean", default: false })
  requiresApproval: boolean;

  @Column({ name: "invite_code", type: "text", nullable: true, unique: true })
  inviteCode: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @OneToMany(() => ProgramWorkoutEntity, (workout) => workout.program)
  workouts?: ProgramWorkoutEntity[];
}
