import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import type { AutoBackupFrequency } from "@replog/shared";

@Entity({ name: "google_drive_backups" })
export class GoogleDriveBackupEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "text", nullable: true })
  email: string | null;

  @Column({ name: "refresh_token", type: "text" })
  refreshToken: string;

  @Column({ type: "text", default: "off" })
  frequency: AutoBackupFrequency;

  @Column({ name: "last_backup_at", type: "timestamptz", nullable: true })
  lastBackupAt: Date | null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
