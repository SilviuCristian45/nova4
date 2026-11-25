import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { WorkoutEntity } from "./workout.entity";

@Entity({ name: "cardio_sessions" })
export class CardioSessionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @ManyToOne(() => WorkoutEntity, (workout) => workout.cardioSessions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "workout_id" })
  workout?: WorkoutEntity;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "text" })
  activity: string;

  @Column({ name: "duration_min", type: "integer" })
  durationMin: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
