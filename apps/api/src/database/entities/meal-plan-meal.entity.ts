import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import type { MealPlanMealType } from "@replog/shared";
import { MealPlanDayEntity } from "./meal-plan-day.entity";
import { MealPlanItemEntity } from "./meal-plan-item.entity";

@Entity({ name: "meal_plan_meals" })
export class MealPlanMealEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "meal_plan_day_id", type: "uuid" })
  mealPlanDayId: string;

  @ManyToOne(() => MealPlanDayEntity, (day) => day.meals, { onDelete: "CASCADE" })
  @JoinColumn({ name: "meal_plan_day_id" })
  day?: MealPlanDayEntity;

  @Column({ type: "integer" })
  position: number;

  @Column({ name: "meal_type", type: "text", default: "Breakfast" })
  mealType: MealPlanMealType;

  @Column({ type: "text" })
  title: string;

  @Column({ name: "time_label", type: "text", nullable: true })
  timeLabel: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @OneToMany(() => MealPlanItemEntity, (item) => item.meal)
  items?: MealPlanItemEntity[];
}
