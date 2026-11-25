import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";
import type { NotificationType } from "@replog/shared";

@Entity({ name: "notifications" })
export class NotificationEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId: string | null;

  @Column({ type: "text" })
  type: NotificationType;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  link: string | null;

  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
