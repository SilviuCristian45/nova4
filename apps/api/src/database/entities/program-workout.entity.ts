import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { ProgramEntity } from "./program.entity";
import { ProgramWorkoutExerciseEntity } from "./program-workout-exercise.entity";
import { ProgramWorkoutCardioEntity } from "./program-workout-cardio.entity";

@Entity({ name: "program_workouts" })
export class ProgramWorkoutEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "program_id", type: "uuid" })
  programId: string;

  @ManyToOne(() => ProgramEntity, (program) => program.workouts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "program_id" })
  program?: ProgramEntity;

  @Column({ name: "week_number", type: "integer", default: 1 })
  weekNumber: number;

  @Column({ name: "day_number", type: "integer" })
  dayNumber: number;

  @Column({ type: "integer", default: 1 })
  position: number;

  @Column({ type: "text" })
  title: string;

  @Column({ name: "workout_mode", type: "text", default: "strength" })
  workoutMode: "strength" | "cardio";

  @Column({ type: "text" })
  split: string;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @OneToMany(() => ProgramWorkoutExerciseEntity, (ex) => ex.programWorkout)
  exercises?: ProgramWorkoutExerciseEntity[];

  @OneToMany(() => ProgramWorkoutCardioEntity, (c) => c.programWorkout)
  cardio?: ProgramWorkoutCardioEntity[];
}
