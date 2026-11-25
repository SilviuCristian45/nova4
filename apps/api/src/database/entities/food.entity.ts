import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "foods" })
export class FoodEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  @Column({ type: "text" })
  name: string;

  @Column({ type: "text", nullable: true })
  brand: string | null;

  @Column({ type: "text", nullable: true, unique: true })
  barcode: string | null;

  @Column({ name: "kcal_per_100g", type: "numeric", default: "0" })
  kcalPer100g: string;

  @Column({ name: "protein_per_100g", type: "numeric", default: "0" })
  proteinPer100g: string;

  @Column({ name: "carbs_per_100g", type: "numeric", default: "0" })
  carbsPer100g: string;

  @Column({ name: "fat_per_100g", type: "numeric", default: "0" })
  fatPer100g: string;

  @Column({ name: "saturated_fat_per_100g", type: "numeric", nullable: true, default: "0" })
  saturatedFatPer100g: string | null;

  @Column({ name: "polyunsaturated_fat_per_100g", type: "numeric", nullable: true, default: "0" })
  polyunsaturatedFatPer100g: string | null;

  @Column({ name: "fiber_per_100g", type: "numeric", nullable: true, default: "0" })
  fiberPer100g: string | null;

  @Column({ name: "sodium_mg_per_100g", type: "numeric", nullable: true, default: "0" })
  sodiumMgPer100g: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
