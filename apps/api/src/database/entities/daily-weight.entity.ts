import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "daily_weight" })
export class DailyWeightEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @PrimaryColumn({ type: "date" })
  date: string;

  @Column({ name: "weight_kg", type: "numeric", precision: 6, scale: 2 })
  weightKg: string;
}
