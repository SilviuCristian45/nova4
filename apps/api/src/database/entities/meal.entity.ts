import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import type { DiaryMealType } from "@replog/shared";
import { MealItemEntity } from "./meal-item.entity";

@Entity({ name: "meals" })
export class MealEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "performed_on", type: "date" })
  performedOn: string;

  @Column({ name: "meal_type", type: "text" })
  mealType: DiaryMealType;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @OneToMany(() => MealItemEntity, (item) => item.meal)
  items?: MealItemEntity[];
}
