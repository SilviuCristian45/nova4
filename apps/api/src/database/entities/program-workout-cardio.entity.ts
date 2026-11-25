import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ProgramWorkoutEntity } from "./program-workout.entity";

@Entity({ name: "program_workout_cardio" })
export class ProgramWorkoutCardioEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "program_workout_id", type: "uuid" })
  programWorkoutId: string;

  @ManyToOne(() => ProgramWorkoutEntity, (workout) => workout.cardio, { onDelete: "CASCADE" })
  @JoinColumn({ name: "program_workout_id" })
  programWorkout?: ProgramWorkoutEntity;

  @Column({ type: "integer" })
  position: number;

  @Column({ type: "text" })
  activity: string;

  @Column({ name: "target_duration_min", type: "integer" })
  targetDurationMin: number;

  @Column({ type: "text", nullable: true })
  notes: string | null;
}
