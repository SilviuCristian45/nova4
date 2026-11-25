import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { MealPlanMealEntity } from "./meal-plan-meal.entity";

@Entity({ name: "meal_plan_items" })
export class MealPlanItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "meal_plan_meal_id", type: "uuid" })
  mealPlanMealId: string;

  @ManyToOne(() => MealPlanMealEntity, (meal) => meal.items, { onDelete: "CASCADE" })
  @JoinColumn({ name: "meal_plan_meal_id" })
  meal?: MealPlanMealEntity;

  @Column({ type: "integer" })
  position: number;

  @Column({ name: "food_id", type: "uuid", nullable: true })
  foodId: string | null;

  @Column({ type: "text" })
  name: string;

  @Column({ type: "text", nullable: true })
  brand: string | null;

  @Column({ type: "numeric", precision: 7, scale: 1 })
  grams: string;

  @Column({ name: "kcal_per_100g", type: "numeric", precision: 7, scale: 2, default: "0" })
  kcalPer100g: string;

  @Column({ name: "protein_per_100g", type: "numeric", precision: 7, scale: 2, default: "0" })
  proteinPer100g: string;

  @Column({ name: "carbs_per_100g", type: "numeric", precision: 7, scale: 2, default: "0" })
  carbsPer100g: string;

  @Column({ name: "fat_per_100g", type: "numeric", precision: 7, scale: 2, default: "0" })
  fatPer100g: string;

  @Column({ name: "fiber_per_100g", type: "numeric", precision: 7, scale: 2, nullable: true })
  fiberPer100g: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;
}
