import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { FeedbackReaction } from "@replog/shared";

@Entity({ name: "workout_feedback" })
export class WorkoutFeedbackEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Column({ name: "author_id", type: "uuid" })
  authorId: string;

  @Column({ type: "text" })
  body: string;

  @Column({ type: "text", nullable: true })
  reaction: FeedbackReaction | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
