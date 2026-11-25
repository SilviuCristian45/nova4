import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import type { ActivityLevel, UserRole, WeightUnit } from "@replog/shared";
import { UserEntity } from "./user.entity";

@Entity({ name: "profiles" })
export class ProfileEntity {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @OneToOne(() => UserEntity, (user) => user.profile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "id" })
  user?: UserEntity;

  @Column({ name: "daily_steps_goal", type: "integer", default: 10000 })
  dailyStepsGoal: number;

  @Column({ name: "display_name", type: "text", nullable: true })
  displayName: string | null;

  @Column({ name: "height_cm", type: "numeric", precision: 4, scale: 1, nullable: true })
  heightCm: string | null;

  @Column({ name: "birth_date", type: "date", nullable: true })
  birthDate: string | null;

  @Column({ type: "text", nullable: true })
  sex: "male" | "female" | null;

  @Column({ name: "weight_unit", type: "text", default: "kg" })
  weightUnit: WeightUnit;

  @Column({ name: "activity_level", type: "text", nullable: true })
  activityLevel: ActivityLevel | null;

  @Column({ name: "goal_kg_per_week", type: "numeric", precision: 3, scale: 2, default: "0" })
  goalKgPerWeek: string;

  @Column({ type: "text", default: "client" })
  role: UserRole;
}
