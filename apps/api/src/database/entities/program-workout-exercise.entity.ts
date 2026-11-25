import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ProgramWorkoutEntity } from "./program-workout.entity";

@Entity({ name: "program_workout_exercises" })
export class ProgramWorkoutExerciseEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "program_workout_id", type: "uuid" })
  programWorkoutId: string;

  @ManyToOne(() => ProgramWorkoutEntity, (workout) => workout.exercises, { onDelete: "CASCADE" })
  @JoinColumn({ name: "program_workout_id" })
  programWorkout?: ProgramWorkoutEntity;

  @Column({ type: "integer" })
  position: number;

  @Column({ type: "text" })
  exercise: string;

  @Column({ name: "set_type", type: "text", default: "Working Set" })
  setType: string;

  @Column({ name: "target_sets", type: "integer" })
  targetSets: number;

  @Column({ name: "target_reps_min", type: "integer" })
  targetRepsMin: number;

  @Column({ name: "target_reps_max", type: "integer" })
  targetRepsMax: number;

  @Column({ name: "target_rir", type: "smallint", nullable: true })
  targetRir: number | null;

  @Column({ name: "target_weight_kg", type: "numeric", precision: 7, scale: 2, nullable: true })
  targetWeightKg: string | null;

  @Column({ name: "rest_seconds", type: "integer", nullable: true })
  restSeconds: number | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;
}
