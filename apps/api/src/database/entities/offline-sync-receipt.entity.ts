import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "offline_sync_receipts" })
export class OfflineSyncReceiptEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @PrimaryColumn({ name: "mutation_id", type: "uuid" })
  mutationId: string;

  @Column({ type: "jsonb" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: "synced_at", type: "timestamptz" })
  syncedAt: Date;
}
