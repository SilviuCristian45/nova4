import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { MealPlanGoal, MealPlanStatus } from "@replog/shared";
import { MealPlanDayEntity } from "./meal-plan-day.entity";

@Entity({ name: "meal_plans" })
export class MealPlanEntity {
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

  @Column({ type: "text", default: "maintenance" })
  goal: MealPlanGoal;

  @Column({ type: "text", default: "draft" })
  status: MealPlanStatus;

  @Column({ name: "target_kcal", type: "integer", nullable: true })
  targetKcal: number | null;

  @Column({ name: "target_protein_g", type: "integer", nullable: true })
  targetProteinG: number | null;

  @Column({ name: "target_carbs_g", type: "integer", nullable: true })
  targetCarbsG: number | null;

  @Column({ name: "target_fat_g", type: "integer", nullable: true })
  targetFatG: number | null;

  @Column({ name: "target_fiber_g", type: "integer", nullable: true })
  targetFiberG: number | null;

  @Column({ name: "water_liters", type: "numeric", precision: 3, scale: 1, nullable: true })
  waterLiters: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ name: "share_token", type: "text", nullable: true, unique: true })
  shareToken: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @OneToMany(() => MealPlanDayEntity, (day) => day.mealPlan)
  days?: MealPlanDayEntity[];
}
