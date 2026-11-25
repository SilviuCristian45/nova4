import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { FoodEntity } from "./food.entity";
import { MealEntity } from "./meal.entity";

@Entity({ name: "meal_items" })
export class MealItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "meal_id", type: "uuid" })
  mealId: string;

  @ManyToOne(() => MealEntity, (meal) => meal.items, { onDelete: "CASCADE" })
  @JoinColumn({ name: "meal_id" })
  meal?: MealEntity;

  @Column({ name: "food_id", type: "uuid" })
  foodId: string;

  @ManyToOne(() => FoodEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "food_id" })
  food?: FoodEntity;

  @Column({ name: "consumed_weight_g", type: "numeric" })
  consumedWeightG: string;

  @Column({ name: "total_kcal", type: "numeric", default: "0" })
  totalKcal: string;

  @Column({ name: "total_protein_g", type: "numeric", default: "0" })
  totalProteinG: string;

  @Column({ name: "total_carbs_g", type: "numeric", default: "0" })
  totalCarbsG: string;

  @Column({ name: "total_fat_g", type: "numeric", default: "0" })
  totalFatG: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
