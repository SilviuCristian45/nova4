import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "user_targets" })
export class UserTargetEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "integer", default: 2200 })
  kcal: number;

  @Column({ type: "integer", default: 160 })
  protein: number;

  @Column({ type: "integer", default: 250 })
  carbs: number;

  @Column({ type: "integer", default: 70 })
  fat: number;

  @Column({ type: "integer", default: 30 })
  fiber: number;

  @Column({ name: "updated_at", type: "timestamptz", nullable: true, default: () => "timezone('utc', now())" })
  updatedAt: Date | null;
}
