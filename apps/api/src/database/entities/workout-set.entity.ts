import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { WorkoutEntity } from "./workout.entity";

@Entity({ name: "workout_sets" })
export class WorkoutSetEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @ManyToOne(() => WorkoutEntity, (workout) => workout.workoutSets, { onDelete: "CASCADE" })
  @JoinColumn({ name: "workout_id" })
  workout?: WorkoutEntity;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "text" })
  split: string;

  @Column({ type: "text" })
  exercise: string;

  @Column({ name: "set_number", type: "integer" })
  setNumber: number;

  @Column({ type: "integer" })
  reps: number;

  @Column({ type: "integer", nullable: true })
  rir: number | null;

  @Column({ name: "set_type", type: "text" })
  setType: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @Column({ type: "numeric", precision: 7, scale: 2, default: "0" })
  weight: string;

  @Column({ type: "varchar", nullable: true })
  notes: string | null;

  @Column({ name: "is_pr", type: "boolean", default: false })
  isPr: boolean;
}
