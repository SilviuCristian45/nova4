import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { MealPlanEntity } from "./meal-plan.entity";
import { MealPlanMealEntity } from "./meal-plan-meal.entity";

@Entity({ name: "meal_plan_days" })
export class MealPlanDayEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "meal_plan_id", type: "uuid" })
  mealPlanId: string;

  @ManyToOne(() => MealPlanEntity, (plan) => plan.days, { onDelete: "CASCADE" })
  @JoinColumn({ name: "meal_plan_id" })
  mealPlan?: MealPlanEntity;

  @Column({ type: "integer" })
  position: number;

  @Column({ type: "text" })
  title: string;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @OneToMany(() => MealPlanMealEntity, (meal) => meal.day)
  meals?: MealPlanMealEntity[];
}
