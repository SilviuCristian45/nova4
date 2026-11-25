import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity({ name: "daily_steps" })
@Unique(["userId", "date"])
export class DailyStepsEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "date" })
  date: string;

  @Column({ type: "integer", default: 0 })
  steps: number;
}
