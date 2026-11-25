import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { WorkoutSetEntity } from "./workout-set.entity";
import { CardioSessionEntity } from "./cardio-session.entity";

@Entity({ name: "workouts" })
export class WorkoutEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "performed_on", type: "date" })
  performedOn: string;

  @Column({ type: "text" })
  split: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @Column({ name: "client_id", type: "text", nullable: true })
  clientId: string | null;

  @Column({ name: "workout_mode", type: "text", default: "strength" })
  workoutMode: "strength" | "cardio";

  @Column({ name: "program_workout_id", type: "uuid", nullable: true })
  programWorkoutId: string | null;

  @Column({ name: "enrollment_id", type: "uuid", nullable: true })
  enrollmentId: string | null;

  @OneToMany(() => WorkoutSetEntity, (set) => set.workout)
  workoutSets?: WorkoutSetEntity[];

  @OneToMany(() => CardioSessionEntity, (cardio) => cardio.workout)
  cardioSessions?: CardioSessionEntity[];
}
