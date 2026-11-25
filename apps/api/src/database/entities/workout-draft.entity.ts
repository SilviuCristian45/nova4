import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "workout_drafts" })
export class WorkoutDraftEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "jsonb" })
  draft: Record<string, unknown>;

  @Column({ name: "client_updated_at", type: "timestamptz" })
  clientUpdatedAt: Date;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt: Date;
}
