import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export type SyncEntityType =
  | "profile"
  | "user_targets"
  | "food"
  | "workout"
  | "meal"
  | "meal_template"
  | "daily_steps"
  | "daily_weight"
  | "daily_checkin"
  | "progress_photo";

export type SyncOperation = "upsert" | "delete";

@Entity({ name: "sync_changes" })
export class SyncChangeEntity {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  seq: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "entity_type", type: "text" })
  entityType: SyncEntityType;

  @Column({ name: "entity_id", type: "text" })
  entityId: string;

  @Column({ type: "text" })
  op: SyncOperation;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt: Date;
}
