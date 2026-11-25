import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "daily_checkin" })
export class DailyCheckinEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @PrimaryColumn({ type: "date" })
  date: string;

  @Column({ type: "smallint", nullable: true })
  energy: number | null;

  @Column({ type: "smallint", nullable: true })
  satiety: number | null;

  @Column({ type: "smallint", nullable: true })
  sleep: number | null;

  @Column({ type: "text", nullable: true })
  note: string | null;
}
